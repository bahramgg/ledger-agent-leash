/**
 * Agent on a Leash — Phase 0 smoke test.
 *
 * Goal: prove the signer side works. Connect to a signer (real Speculos device,
 * or the labelled mock) and read a Solana address. No agent, no policy yet.
 *
 *   Real device:  npm run demo                 (needs Speculos on :5000)
 *   Simulation:   USE_MOCK_SIGNER=true npm run demo
 */

import { loadConfig } from "./config.js";
import { createSigner } from "./signer/signer.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("=== Agent on a Leash — Phase 0: signer smoke test ===\n");
  if (config.useMockSigner) {
    console.log("SIGNER MODE : ⚠️  MOCK (simulation, no real device) — USE_MOCK_SIGNER=true");
  } else {
    console.log(`SIGNER MODE : REAL — Speculos device at ${config.speculosUrl}`);
  }
  console.log(`PATH        : ${config.derivationPath}`);
  console.log(`RPC         : ${config.solanaRpcUrl} (devnet)\n`);

  console.log("CONNECT     : establishing signer session…");
  const signer = await createSigner(config);

  try {
    console.log("READ ADDRESS: requesting Solana address from the signer…");
    const { address, derivationPath } = await signer.getAddress();

    console.log("\n----------------------------------------------------------");
    console.log(`  Solana address : ${address}`);
    console.log(`  Derivation path: ${derivationPath}`);
    console.log(`  Source         : ${signer.kind === "mock" ? "MOCK (fake)" : "Speculos device"}`);
    console.log("----------------------------------------------------------\n");

    if (signer.kind === "mock") {
      console.log("Note: this address is FAKE (simulation). Run against Speculos for a real one.");
    } else {
      console.log("✓ Read a real address from the Speculos-emulated Ledger device.");
    }
  } finally {
    await signer.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error("\n✗ Phase 0 failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
