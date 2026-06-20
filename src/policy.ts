import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE LEASH.
 *
 * A pure, deterministic policy gate. It takes a transaction intent and returns
 * ALLOW or BLOCK with a reason. There is NO LLM call in this file, and there
 * never will be — that is the whole point. Because the decision is plain code,
 * it cannot be prompt-injected: a compromised agent can propose anything, but
 * the rules here decide what actually gets signed.
 *
 * `checkPolicy` is a pure function (no I/O, no globals) so it is trivially
 * unit-testable. State (cumulative daily spend) is passed in as an argument and
 * tracked separately by SessionLedger.
 */

export interface TransactionIntent {
  destination: string;
  amountSol: number;
  token: string;
}

export interface Policy {
  /** Single-transaction ceiling, in SOL. */
  maxAmountPerTx: number;
  /** Cumulative daily ceiling, in SOL. */
  dailyCap: number;
  /** Destinations the agent is allowed to pay. Empty means "allow any". */
  allowlist: string[];
  /** Destinations always refused, regardless of anything else. */
  blocklist: string[];
}

export type PolicyDecision = "ALLOW" | "BLOCK";

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

const allow = (reason: string): PolicyResult => ({ decision: "ALLOW", reason });
const block = (reason: string): PolicyResult => ({ decision: "BLOCK", reason });

/**
 * Evaluate a transaction intent against the policy.
 *
 * Rules are checked in a fixed, deterministic order. The blocklist is checked
 * before the allowlist, so a blocklisted destination is always refused.
 *
 * @param intent        the proposed transaction
 * @param policy        the rules
 * @param dailySpentSol cumulative SOL already spent this session (toward dailyCap)
 */
export function checkPolicy(
  intent: TransactionIntent,
  policy: Policy,
  dailySpentSol: number,
): PolicyResult {
  // 0. Structural sanity — reject malformed intents outright.
  if (!intent.destination || intent.destination.trim() === "") {
    return block("Intent has no destination address.");
  }
  if (!Number.isFinite(intent.amountSol) || intent.amountSol <= 0) {
    return block(`Invalid amount: ${intent.amountSol} SOL must be a positive number.`);
  }

  // 1. Token — this demo only moves native SOL.
  if (intent.token !== "SOL") {
    return block(`Unsupported token "${intent.token}" — only SOL is allowed.`);
  }

  // 2. Blocklist — always refused, highest precedence.
  if (policy.blocklist.includes(intent.destination)) {
    return block(`Destination ${intent.destination} is on the blocklist.`);
  }

  // 3. Allowlist — if one is configured, the destination must be on it.
  if (policy.allowlist.length > 0 && !policy.allowlist.includes(intent.destination)) {
    return block(`Destination ${intent.destination} is not on the allowlist.`);
  }

  // 4. Per-transaction cap.
  if (intent.amountSol > policy.maxAmountPerTx) {
    return block(
      `Amount ${intent.amountSol} SOL exceeds the per-transaction cap of ${policy.maxAmountPerTx} SOL.`,
    );
  }

  // 5. Daily cumulative cap.
  const projected = dailySpentSol + intent.amountSol;
  if (projected > policy.dailyCap) {
    return block(
      `Amount ${intent.amountSol} SOL would bring today's total to ${projected} SOL, ` +
        `over the daily cap of ${policy.dailyCap} SOL (already spent ${dailySpentSol} SOL).`,
    );
  }

  // 6. Within every rule.
  return allow(
    `${intent.amountSol} SOL to ${intent.destination} is within all policy limits.`,
  );
}

/**
 * Tracks cumulative spend for the current session, in memory only.
 * Reset every time the process restarts.
 */
export class SessionLedger {
  private spent = 0;

  get spentSol(): number {
    return this.spent;
  }

  /** Record an executed transfer's amount toward the daily cap. */
  record(amountSol: number): void {
    this.spent += amountSol;
  }
}

/** Load and validate policy.json from the project root (or an explicit path). */
export function loadPolicy(path = resolve(process.cwd(), "policy.json")): Policy {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Policy>;

  if (
    typeof raw.maxAmountPerTx !== "number" ||
    typeof raw.dailyCap !== "number" ||
    !Array.isArray(raw.allowlist) ||
    !Array.isArray(raw.blocklist)
  ) {
    throw new Error(
      `Invalid policy.json at ${path}: expected maxAmountPerTx, dailyCap (numbers) ` +
        `and allowlist, blocklist (arrays).`,
    );
  }

  return {
    maxAmountPerTx: raw.maxAmountPerTx,
    dailyCap: raw.dailyCap,
    allowlist: raw.allowlist,
    blocklist: raw.blocklist,
  };
}
