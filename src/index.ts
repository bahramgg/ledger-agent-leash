/**
 * Agent on a Leash — the Stage.
 *
 * Wires the four parts together and prints a readable decision trace:
 *   INSTRUCTION -> INTENT -> POLICY CHECK -> ALLOWED/BLOCKED -> SIGNING -> CONFIRMED
 *
 *   Happy path (this phase):
 *     USE_MOCK_SIGNER=true npm run demo -- --scenario safe
 *
 *   Real device (local Speculos):
 *     npm run demo -- --scenario safe
 */

import { createDeterministicBrain } from "./agent.js";
import { loadConfig } from "./config.js";
import { loadPolicy, SessionLedger, type Policy } from "./policy.js";
import { runInstruction } from "./orchestrator.js";
import { createSigner } from "./signer/signer.js";

interface Scenario {
  title: string;
  /** Build the instruction the brain will receive. */
  instruction: (policy: Policy) => string;
}

const SCENARIOS: Record<string, Scenario> = {
  safe: {
    title: "Safe transfer — small, in-policy payment to an allowlisted address",
    instruction: (policy) => `send 0.01 SOL to ${policy.allowlist[0]}`,
  },
  // "over-limit" and "attack" scenarios arrive in later phases.
};

function parseScenario(argv: string[]): string {
  const i = argv.indexOf("--scenario");
  return i !== -1 && argv[i + 1] ? argv[i + 1]! : "safe";
}

async function main(): Promise<void> {
  const config = loadConfig();
  const policy = loadPolicy();
  const scenarioName = parseScenario(process.argv.slice(2));

  const scenario = SCENARIOS[scenarioName];
  if (!scenario) {
    const known = Object.keys(SCENARIOS).join(", ");
    throw new Error(`Unknown scenario "${scenarioName}". Available: ${known}.`);
  }

  console.log("=== Agent on a Leash ===");
  console.log(`SCENARIO    : ${scenarioName} — ${scenario.title}`);
  console.log(
    `SIGNER MODE : ${config.useMockSigner ? "⚠️  MOCK (simulation)" : `REAL — Speculos @ ${config.speculosUrl}`}`,
  );
  console.log(`POLICY      : max ${policy.maxAmountPerTx} SOL/tx, daily cap ${policy.dailyCap} SOL, ` +
    `${policy.allowlist.length} allowlisted, ${policy.blocklist.length} blocklisted`);

  const brain = createDeterministicBrain();
  const ledger = new SessionLedger();
  const signer = await createSigner(config);

  try {
    const result = await runInstruction({
      instruction: scenario.instruction(policy),
      brain,
      signer,
      policy,
      ledger,
    });

    console.log(
      `\nRESULT      : ${result.decision === "ALLOW" ? "transaction signed ✅" : "transaction blocked ⛔"}`,
    );
  } finally {
    await signer.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error("\n✗ Run failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
