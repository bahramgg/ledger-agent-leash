import type { Brain } from "./agent.js";
import { checkPolicy, type Policy, type SessionLedger } from "./policy.js";
import type { LeashSigner } from "./signer/signer.js";
import { buildTransferMessage } from "./transaction.js";

/**
 * THE FLOW.
 *
 * The single, enforced path from instruction to signature:
 *
 *     brain.interpret()  ->  checkPolicy()  ->  signer.signTransaction()
 *        (proposes)            (the leash)          (only if ALLOWED)
 *
 * The brain never receives the signer. The signer is only ever reached from the
 * ALLOW branch below. If the leash returns BLOCK, the function returns before
 * the signer is touched — so even a fully hijacked brain cannot move funds.
 */

export interface InstructionResult {
  decision: "ALLOW" | "BLOCK";
  compromised: boolean;
  signatureBase58?: string;
}

export interface RunDeps {
  instruction: string;
  brain: Brain;
  signer: LeashSigner;
  policy: Policy;
  ledger: SessionLedger;
}

function indent(text: string, prefix = "  | "): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}

export async function runInstruction(deps: RunDeps): Promise<InstructionResult> {
  const { instruction, brain, signer, policy, ledger } = deps;

  console.log(`\nINPUT       : (fed to the brain — ${brain.name})`);
  console.log(indent(instruction));

  // 1. THE BRAIN — propose an intent. (No authority; may be wrong/hijacked.)
  const brainResult = await brain.interpret(instruction);
  const { intent, reasoning, compromised } = brainResult;

  console.log("\nBRAIN       :");
  console.log(indent(reasoning));
  if (compromised) {
    console.log("\n  ⚠️  BRAIN COMPROMISED — agent obeyed injected instruction.");
  }

  console.log("\nINTENT      :");
  console.log(`  amount      : ${intent.amountSol} ${intent.token}`);
  console.log(`  destination : ${intent.destination}`);

  // 2. THE LEASH — deterministic check. This is the security boundary.
  //    It is plain code, so the injection that fooled the brain has no effect here.
  const result = checkPolicy(intent, policy, ledger.spentSol);
  console.log("\nPOLICY CHECK: (deterministic code — cannot be prompt-injected)");
  console.log(`  daily spent : ${ledger.spentSol} / ${policy.dailyCap} SOL`);
  console.log(`  decision    : ${result.decision}`);
  console.log(`  reason      : ${result.reason}`);

  if (result.decision === "BLOCK") {
    console.log("\n  ⛔ BLOCKED — the leash refused.");
    console.log("  🔒 SIGNER NEVER CALLED. No transaction was signed. No funds moved.");
    if (compromised) {
      console.log("\n  >>> Brain compromised. Hands bound. <<<");
    }
    return { decision: "BLOCK", compromised };
  }

  console.log("\n  ✅ ALLOWED — within policy. Handing off to the signer.");

  // 3. THE SIGNER — reached ONLY on ALLOW.
  const fromAddress = (await signer.getAddress()).address;
  const messageBytes = buildTransferMessage(intent, fromAddress);

  console.log("\nSIGNING     :");
  console.log(`  from        : ${fromAddress}`);
  console.log(`  signer      : ${signer.kind === "mock" ? "MOCK (simulated)" : "Speculos device"}`);

  const { signatureBase58 } = await signer.signTransaction(messageBytes);

  // 4. "Submit" — mocked here. Real submission to the cluster is a later phase.
  ledger.record(intent.amountSol);

  console.log("\nCONFIRMED   :");
  console.log(`  signature   : ${signatureBase58}`);
  console.log(`  daily spent : ${ledger.spentSol} / ${policy.dailyCap} SOL`);
  console.log("  (submission to devnet is mocked in this phase)");

  return { decision: "ALLOW", compromised, signatureBase58 };
}
