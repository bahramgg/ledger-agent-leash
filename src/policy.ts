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

/** A single rule's outcome — used to render the policy check in the UI. */
export interface PolicyCheck {
  /** Stable identifier, e.g. "maxAmountPerTx" or "allowlist". */
  id: string;
  /** Human-readable rule name. */
  rule: string;
  pass: boolean;
  /** One-line explanation of the outcome. */
  detail: string;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  reason: string;
  checks: PolicyCheck[];
}

/**
 * Evaluate a transaction intent against the policy, returning a per-rule
 * breakdown. This is the single source of truth for the rules; both the CLI
 * (via `checkPolicy`) and the web server consume it — neither re-implements a
 * rule. Deterministic, no I/O, no globals: trivially unit-testable.
 *
 * @param intent        the proposed transaction
 * @param policy        the rules
 * @param dailySpentSol cumulative SOL already spent this session (toward dailyCap)
 */
export function evaluatePolicy(
  intent: TransactionIntent,
  policy: Policy,
  dailySpentSol: number,
): PolicyEvaluation {
  const { destination, amountSol, token } = intent;
  const dest = (destination ?? "").trim();
  const amountValid = Number.isFinite(amountSol) && amountSol > 0;
  const projected = dailySpentSol + amountSol;

  const checks: PolicyCheck[] = [];

  // Blocklist — always refused.
  checks.push({
    id: "blocklist",
    rule: "Not on the blocklist",
    pass: !policy.blocklist.includes(dest),
    detail: policy.blocklist.includes(dest)
      ? `destination ${dest} is on the blocklist`
      : "destination is not blocklisted",
  });

  // Allowlist — empty list means "allow any"; an empty destination always fails.
  const allowlistPass =
    dest !== "" && (policy.allowlist.length === 0 || policy.allowlist.includes(dest));
  checks.push({
    id: "allowlist",
    rule: "Destination on your allowlist",
    pass: allowlistPass,
    detail: allowlistPass
      ? policy.allowlist.length === 0
        ? "any destination allowed (no allowlist set)"
        : `${dest} is on the allowlist`
      : dest === ""
        ? "no destination provided"
        : `destination ${dest} is not on the allowlist`,
  });

  // Per-transaction cap (also rejects non-positive / non-finite amounts).
  const capPass = amountValid && amountSol <= policy.maxAmountPerTx;
  checks.push({
    id: "maxAmountPerTx",
    rule: "Within your spending cap",
    pass: capPass,
    detail: !amountValid
      ? `amount ${amountSol} SOL is not a valid positive amount`
      : amountSol > policy.maxAmountPerTx
        ? `amount ${amountSol} SOL exceeds the per-transaction cap of ${policy.maxAmountPerTx} SOL`
        : `amount ${amountSol} SOL is within the per-transaction cap of ${policy.maxAmountPerTx} SOL`,
  });

  // Daily cumulative cap.
  const dailyPass = projected <= policy.dailyCap;
  checks.push({
    id: "dailyCap",
    rule: "Within the daily cap",
    pass: dailyPass,
    detail: dailyPass
      ? `within the daily cap of ${policy.dailyCap} SOL`
      : `amount ${amountSol} SOL would bring today's total to ${projected} SOL, ` +
        `over the daily cap of ${policy.dailyCap} SOL (already spent ${dailySpentSol} SOL)`,
  });

  // Token — this demo only moves native SOL.
  checks.push({
    id: "token",
    rule: "SOL only",
    pass: token === "SOL",
    detail: token === "SOL" ? "token is SOL" : `unsupported token "${token}" — only SOL is allowed`,
  });

  const failed = checks.filter((c) => !c.pass);
  const decision: PolicyDecision = failed.length === 0 ? "ALLOW" : "BLOCK";
  const reason =
    decision === "ALLOW"
      ? `${amountSol} SOL to ${dest} is within all policy limits.`
      : failed.map((c) => c.detail).join("; ") + ".";

  return { decision, reason, checks };
}

/**
 * Thin wrapper over {@link evaluatePolicy} returning just the verdict + reason.
 * Used by the CLI orchestrator and the unit tests.
 */
export function checkPolicy(
  intent: TransactionIntent,
  policy: Policy,
  dailySpentSol: number,
): PolicyResult {
  const { decision, reason } = evaluatePolicy(intent, policy, dailySpentSol);
  return { decision, reason };
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
