import type { Brain } from "./agent.js";
import { checkPolicy, type Policy, type SessionLedger } from "./policy.js";
import type { LeashSigner } from "./signer/signer.js";
import { buildTransferMessage } from "./transaction.js";
import { box, field, paint, quote, section, thinRule } from "./ui.js";

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

export async function runInstruction(deps: RunDeps): Promise<InstructionResult> {
  const { instruction, brain, signer, policy, ledger } = deps;

  // ── INPUT ───────────────────────────────────────────────────
  console.log(section("INPUT", `→ fed to the brain (${brain.name})`));
  console.log(quote(instruction));

  // 1. THE BRAIN — propose an intent. (No authority; may be wrong/hijacked.)
  const { intent, reasoning, compromised } = await brain.interpret(instruction);

  console.log("");
  console.log(section("BRAIN"));
  console.log(quote(reasoning));
  if (compromised) {
    console.log(
      "    " + paint("⚠  BRAIN COMPROMISED — agent obeyed injected instruction", "bold", "yellow"),
    );
  }

  // ── INTENT ──────────────────────────────────────────────────
  console.log("");
  console.log(section("INTENT", "what the agent wants to do"));
  console.log(field("amount", paint(`${intent.amountSol} ${intent.token}`, "bold")));
  console.log(field("destination", intent.destination));

  // 2. THE LEASH — deterministic check. This is the security boundary.
  //    Plain code, so the injection that fooled the brain has no effect here.
  const result = checkPolicy(intent, policy, ledger.spentSol);

  console.log("");
  console.log(section("POLICY CHECK", "deterministic — cannot be prompt-injected"));
  console.log(field("daily spent", `${ledger.spentSol} / ${policy.dailyCap} SOL`));
  console.log(
    field(
      "decision",
      result.decision === "ALLOW"
        ? paint("ALLOW", "bold", "green")
        : paint("BLOCK", "bold", "red"),
    ),
  );
  console.log(field("reason", paint(result.reason, "dim")));

  if (result.decision === "BLOCK") {
    console.log("");
    console.log("  " + paint("⛔ BLOCKED — the leash refused.", "bold", "red"));
    console.log(
      "  " + paint("🔒 signer never called · no transaction signed · no funds moved", "red"),
    );
    if (compromised) {
      console.log("");
      console.log(box("Brain compromised.  Hands bound.", "bold", "red"));
    }
    return { decision: "BLOCK", compromised };
  }

  console.log("");
  console.log("  " + paint("✅ ALLOWED — within policy. Handing off to the signer.", "bold", "green"));

  // 3. THE SIGNER — reached ONLY on ALLOW.
  const fromAddress = (await signer.getAddress()).address;
  const messageBytes = buildTransferMessage(intent, fromAddress);

  console.log("");
  console.log(section("SIGNING"));
  console.log(field("from", fromAddress));
  console.log(field("signer", signer.kind === "mock" ? "MOCK (simulated)" : "Speculos device"));

  const { signatureBase58 } = await signer.signTransaction(messageBytes);

  // 4. "Submit" — mocked here. Real submission to the cluster is a later phase.
  ledger.record(intent.amountSol);

  console.log("");
  console.log(section("CONFIRMED", "submission to devnet is mocked in this phase"));
  console.log(field("signature", paint(signatureBase58, "green")));
  console.log(field("daily spent", `${ledger.spentSol} / ${policy.dailyCap} SOL`));
  console.log("");
  console.log(thinRule());

  return { decision: "ALLOW", compromised, signatureBase58 };
}
