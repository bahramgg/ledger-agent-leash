import { createHash } from "node:crypto";

import type { AppConfig } from "../config.js";
import type { LeashSigner, SignerAddress, SignerSignature } from "./signer.js";
import { toBase58 } from "../util/base58.js";

/**
 * ⚠️  MOCK SIGNER — SIMULATION ONLY. NOT A REAL DEVICE.
 *
 * This exists so the demo can run end-to-end in environments that cannot run
 * Speculos (e.g. a cloud sandbox without Docker). It returns values that LOOK
 * like real Solana output — a 32-byte Base58 address, a 64-byte Base58 signature
 * — but they are entirely fabricated. No keys, no cryptography, no device.
 *
 * It is selected ONLY when USE_MOCK_SIGNER=true, and is loaded via dynamic import
 * so it never touches the real signing path. Never enable this for anything that
 * matters.
 */

export function createMockSigner(config: AppConfig): LeashSigner {
  return {
    kind: "mock",

    async getAddress(): Promise<SignerAddress> {
      // Deterministically derive 32 fake bytes from the path, so the same path
      // always yields the same address — like a real wallet would.
      const bytes = createHash("sha256")
        .update(`mock-solana-address:${config.derivationPath}`)
        .digest();
      return { address: toBase58(bytes), derivationPath: config.derivationPath };
    },

    async signTransaction(messageBytes: Uint8Array): Promise<SignerSignature> {
      // 64 bytes (ed25519 signature size), deterministically faked from the input.
      const signature = new Uint8Array(createHash("sha512").update(messageBytes).digest());
      return { signature, signatureBase58: toBase58(signature) };
    },

    async disconnect(): Promise<void> {
      // Nothing to disconnect in simulation mode.
    },
  };
}
