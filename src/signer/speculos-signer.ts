import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
  UserInteractionRequired,
  type DeviceActionState,
} from "@ledgerhq/device-management-kit";
import { speculosTransportFactory } from "@ledgerhq/device-transport-kit-speculos";
import { SignerSolanaBuilder } from "@ledgerhq/device-signer-kit-solana";
import { filter, firstValueFrom, timeout, type Observable } from "rxjs";

import type { AppConfig } from "../config.js";
import type { LeashSigner, SignerAddress, SignerSignature } from "./signer.js";
import { toBase58 } from "../util/base58.js";

/**
 * REAL signing path.
 *
 * Device Management Kit + Solana Signer Kit over the Speculos transport. This is
 * the code that runs locally against a Speculos instance. It never returns a
 * value the device did not produce.
 */

const DISCOVERY_TIMEOUT_MS = 15_000;

/** A signer/device action result: an observable plus a cancel handle. */
type RunnableAction<Output> = {
  observable: Observable<DeviceActionState<Output, unknown, unknown>>;
  cancel: () => void;
};

/** Print device interaction prompts to stderr so stdout stays clean for data. */
function printPrompt(interaction: UserInteractionRequired): void {
  const prompts: Partial<Record<UserInteractionRequired, string>> = {
    [UserInteractionRequired.UnlockDevice]: "unlock the device (enter PIN)…",
    [UserInteractionRequired.ConfirmOpenApp]: "confirm opening the Solana app…",
    [UserInteractionRequired.VerifyAddress]: "verify the address on screen…",
    [UserInteractionRequired.SignTransaction]: "review and approve the transaction…",
  };
  const msg = prompts[interaction];
  if (msg) process.stderr.write(`   ↳ device: ${msg}\n`);
}

/** Drive a DMK device-action observable to its terminal state as a promise. */
function runDeviceAction<Output>(action: RunnableAction<Output>): Promise<Output> {
  return new Promise<Output>((resolve, reject) => {
    const sub = action.observable.subscribe({
      next: (state) => {
        switch (state.status) {
          case DeviceActionStatus.Pending:
            printPrompt(
              (state.intermediateValue as { requiredUserInteraction: UserInteractionRequired })
                .requiredUserInteraction,
            );
            break;
          case DeviceActionStatus.Completed:
            sub.unsubscribe();
            resolve(state.output);
            break;
          case DeviceActionStatus.Error:
            sub.unsubscribe();
            reject(state.error instanceof Error ? state.error : new Error(String(state.error)));
            break;
          case DeviceActionStatus.Stopped:
            sub.unsubscribe();
            reject(new Error("Device action was stopped before completing."));
            break;
          default:
            break;
        }
      },
      error: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
    });
  });
}

export async function createSpeculosSigner(config: AppConfig): Promise<LeashSigner> {
  const dmk = new DeviceManagementKitBuilder()
    .addTransport(speculosTransportFactory(config.speculosUrl))
    .build();

  // The Speculos transport advertises a single emulated device immediately;
  // connecting then reaches out to the Speculos HTTP endpoint.
  let sessionId: string;
  try {
    const devices = await firstValueFrom(
      dmk.listenToAvailableDevices({}).pipe(
        filter((list) => list.length > 0),
        timeout(DISCOVERY_TIMEOUT_MS),
      ),
    );
    sessionId = await dmk.connect({ device: devices[0]! });
  } catch (err) {
    dmk.close();
    throw new Error(
      `Could not reach Speculos at ${config.speculosUrl}. ` +
        `Is the emulator running with the Solana app open? ` +
        `(underlying error: ${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const signer = new SignerSolanaBuilder({
    dmk,
    sessionId,
    solanaRPCURL: config.solanaRpcUrl,
    // The Solana signer's ContextModule validates a non-empty origin token at
    // build time (HttpOwnerInfoDataSource throws "origin token is required"
    // otherwise). That datasource is only queried for SPL token clear-signing,
    // never for a native SOL transfer, so any non-empty token lets DMK connect.
    originToken: config.ledgerOriginToken,
  }).build();

  return {
    kind: "speculos",

    async getAddress(): Promise<SignerAddress> {
      const address = await runDeviceAction<string>(
        signer.getAddress(config.derivationPath, {
          checkOnDevice: config.checkAddressOnDevice,
        }),
      );
      return { address, derivationPath: config.derivationPath };
    },

    async signTransaction(messageBytes: Uint8Array): Promise<SignerSignature> {
      const signature = await runDeviceAction<Uint8Array>(
        signer.signTransaction(config.derivationPath, messageBytes),
      );
      return { signature, signatureBase58: toBase58(signature) };
    },

    async disconnect(): Promise<void> {
      await dmk.disconnect({ sessionId });
      dmk.close();
    },
  };
}
