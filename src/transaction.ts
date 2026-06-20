import type { TransactionIntent } from "./policy.js";

/**
 * Build the bytes the signer will sign for a transfer.
 *
 * NOTE: this is a deterministic PLACEHOLDER, not a real Solana transaction.
 * Real Solana signing needs a properly serialized transaction message (recent
 * blockhash, account keys, a System Program transfer instruction), which is a
 * Phase 2 concern. For the Phase 1 happy path against the mock signer, we only
 * need stable, intent-derived bytes to hand to the signer.
 *
 * === REAL TRANSACTION CONSTRUCTION PLUGS IN HERE ===
 * Replace this with @solana/web3.js (SystemProgram.transfer + a recent
 * blockhash) and serialize the message before passing it to the signer.
 */
export function buildTransferMessage(
  intent: TransactionIntent,
  fromAddress: string,
): Uint8Array {
  const canonical = [
    "solana-transfer",
    `from:${fromAddress}`,
    `to:${intent.destination}`,
    `amount:${intent.amountSol}`,
    `token:${intent.token}`,
  ].join("\n");
  return new TextEncoder().encode(canonical);
}
