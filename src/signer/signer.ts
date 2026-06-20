import type { AppConfig } from "../config.js";

/**
 * The signer boundary.
 *
 * Everything above the signer (the agent, the policy gate) deals only in this
 * interface. There are two implementations:
 *
 *   - speculos-signer.ts : the REAL path. Ledger Device Management Kit + Solana
 *                          Signer Kit talking to a Speculos emulated device.
 *   - mock-signer.ts     : a SIMULATION. Clearly labelled, returns fake-but-
 *                          realistic values so the demo runs without hardware.
 *
 * The two never mix. `createSigner` picks exactly one based on config, and uses
 * dynamic import so mock mode never even loads the real DMK code path.
 */

export interface SignerAddress {
  /** Base58-encoded Solana public key. */
  address: string;
  derivationPath: string;
}

export interface SignerSignature {
  /** Raw 64-byte ed25519 signature. */
  signature: Uint8Array;
  /** Base58-encoded form of the same signature, for display. */
  signatureBase58: string;
}

export interface LeashSigner {
  /** Which implementation answered — "speculos" (real) or "mock" (simulation). */
  readonly kind: "speculos" | "mock";
  /** Read the Solana address for the configured derivation path. */
  getAddress(): Promise<SignerAddress>;
  /** Sign serialized Solana transaction message bytes. */
  signTransaction(messageBytes: Uint8Array): Promise<SignerSignature>;
  /** Release the device session (no-op in mock mode). */
  disconnect(): Promise<void>;
}

export async function createSigner(config: AppConfig): Promise<LeashSigner> {
  if (config.useMockSigner) {
    const { createMockSigner } = await import("./mock-signer.js");
    return createMockSigner(config);
  }
  const { createSpeculosSigner } = await import("./speculos-signer.js");
  return createSpeculosSigner(config);
}
