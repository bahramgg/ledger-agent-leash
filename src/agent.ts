import type { TransactionIntent } from "./policy.js";

/**
 * THE BRAIN.
 *
 * Turns a natural-language instruction into a structured transaction intent.
 * This is the part of the system that is *allowed to be fooled* — in later
 * phases an LLM sits here and can be prompt-injected. That is fine, because the
 * brain has no authority: it only proposes. Everything it produces must still
 * pass THE LEASH (policy.ts) before the signer ever sees it.
 *
 * Structural invariant: the brain NEVER imports or calls the signer. It returns
 * an intent and nothing more. The only path to a signature is
 * brain -> leash -> signer, enforced by the orchestrator.
 *
 * For Phase 1 we parse deterministically (no API key needed) so the happy path
 * is testable. The `Brain` interface is async and intentionally LLM-shaped so a
 * model-backed implementation can drop in without changing any caller.
 */

export interface Brain {
  /** The human-readable name of this brain (for the trace). */
  readonly name: string;
  /** Interpret an instruction into a proposed transaction intent. */
  interpret(instruction: string): Promise<TransactionIntent>;
}

const SOL_AMOUNT = /(\d+(?:\.\d+)?)\s*SOL\b/i;
// Base58 (Bitcoin/Solana alphabet): no 0, O, I, l. Solana addresses are 32–44 chars.
const BASE58_ADDRESS = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/;

/**
 * A deterministic, rule-based brain. Extracts an amount and a destination
 * address from instructions like "send 0.01 SOL to <address>".
 *
 * This is a stand-in for the LLM-backed brain. The seam is marked below.
 */
export function createDeterministicBrain(): Brain {
  return {
    name: "deterministic-parser",

    async interpret(instruction: string): Promise<TransactionIntent> {
      // ============================================================
      // === LLM PLUGS IN HERE ======================================
      // In a later phase this method calls an LLM (key from an env var)
      // to extract { destination, amountSol, token } from `instruction`.
      // The return type and the brain -> leash -> signer flow stay the
      // same — only the extraction strategy changes. The LLM is the
      // decision-maker for *what to propose*; it is never the authority
      // on *what gets signed*.
      // ============================================================

      const amountMatch = instruction.match(SOL_AMOUNT);
      if (!amountMatch) {
        throw new Error(`Could not find a SOL amount in instruction: "${instruction}"`);
      }

      const addressMatch = instruction.match(BASE58_ADDRESS);
      if (!addressMatch) {
        throw new Error(`Could not find a destination address in instruction: "${instruction}"`);
      }

      return {
        amountSol: Number(amountMatch[1]),
        destination: addressMatch[1]!,
        token: "SOL",
      };
    },
  };
}
