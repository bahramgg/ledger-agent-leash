import type { TransactionIntent } from "./policy.js";
import { fromBase58 } from "./util/base58.js";

/** The System Program id, base58 — a transfer's program account. */
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
/** SystemProgram instruction index for Transfer (Create=0, Assign=1, Transfer=2). */
const SYSTEM_TRANSFER_INSTRUCTION = 2;
const LAMPORTS_PER_SOL = 1_000_000_000;

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

/** Convert a SOL amount to integer lamports (the on-chain unit). */
export function solToLamports(amountSol: number): bigint {
  return BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));
}

/** Solana compact-u16 (shortvec) length prefix. */
function encodeCompactU16(value: number): number[] {
  const out: number[] = [];
  let v = value;
  for (;;) {
    let elem = v & 0x7f;
    v >>= 7;
    if (v === 0) {
      out.push(elem);
      break;
    }
    elem |= 0x80;
    out.push(elem);
  }
  return out;
}

function expect32(bytes: Uint8Array, what: string): Uint8Array {
  if (bytes.length !== 32) {
    throw new Error(`${what} did not decode to 32 bytes (got ${bytes.length}).`);
  }
  return bytes;
}

/**
 * Serialize a REAL legacy Solana transaction MESSAGE for a single SystemProgram
 * transfer — the exact bytes the Ledger Solana app signs.
 *
 * This is what the real signer path hands to the device: a parseable transfer
 * (so the app clear-signs amount + recipient), not the text placeholder above.
 * We never submit it; we only need a faithfully serialized, signable message.
 *
 * Account order follows Solana's rules: writable signer (from) first, then the
 * writable non-signer (to), then the read-only non-signer (System Program).
 */
export function buildSolanaTransferMessage(args: {
  fromBase58: string;
  toBase58: string;
  lamports: bigint;
  recentBlockhashBase58: string;
}): Uint8Array {
  const from = expect32(fromBase58(args.fromBase58), "sender address");
  const to = expect32(fromBase58(args.toBase58), "destination address");
  const programId = expect32(fromBase58(SYSTEM_PROGRAM_ID), "System Program id");
  const blockhash = expect32(fromBase58(args.recentBlockhashBase58), "recent blockhash");

  // Instruction data: u32 LE instruction index + u64 LE lamports.
  const data: number[] = [];
  let ins = SYSTEM_TRANSFER_INSTRUCTION;
  for (let i = 0; i < 4; i++) {
    data.push(ins & 0xff);
    ins >>>= 8;
  }
  let lamports = args.lamports;
  for (let i = 0; i < 8; i++) {
    data.push(Number(lamports & 0xffn));
    lamports >>= 8n;
  }

  const bytes: number[] = [];
  // Message header: 1 required signature, 0 read-only signed, 1 read-only unsigned.
  bytes.push(1, 0, 1);
  // Account keys: [from, to, systemProgram].
  bytes.push(...encodeCompactU16(3));
  bytes.push(...from, ...to, ...programId);
  // Recent blockhash.
  bytes.push(...blockhash);
  // Instructions: one transfer.
  bytes.push(...encodeCompactU16(1));
  bytes.push(2); // programIdIndex -> System Program
  bytes.push(...encodeCompactU16(2)); // account indexes count
  bytes.push(0, 1); // from, to
  bytes.push(...encodeCompactU16(data.length));
  bytes.push(...data);

  return new Uint8Array(bytes);
}

/**
 * Fetch a recent blockhash from a Solana JSON-RPC endpoint (devnet). Used by the
 * real signer path so the signed message carries a genuine recent blockhash.
 * Throws with the real error on failure — never substitutes a fake value.
 */
export async function fetchRecentBlockhash(
  rpcUrl: string,
  timeoutMs = 10_000,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestBlockhash",
        params: [{ commitment: "finalized" }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`RPC ${rpcUrl} returned HTTP ${res.status}`);
    const json = (await res.json()) as {
      result?: { value?: { blockhash?: string } };
      error?: { message?: string };
    };
    const blockhash = json.result?.value?.blockhash;
    if (!blockhash) {
      throw new Error(json.error?.message ?? "RPC response had no blockhash");
    }
    return blockhash;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Timed out fetching a recent blockhash from ${rpcUrl}`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}
