# Agent on a Leash

> An autonomous AI agent that can be fully hijacked — and still cannot move your funds.

Built on the Ledger Agent Stack (Device Management Kit + Solana Signer Kit + Speculos). The agent proposes transactions; a deterministic policy gate and a hardware signer decide what actually gets signed. Even when the agent's reasoning is compromised by a prompt-injection attack, the signing boundary holds.

## The idea in one sentence

Software can prepare a transaction and software can explain a transaction, but software should not be the final authority when value moves. This project puts that authority where it cannot be argued with: in deterministic policy code and a hardware signer the agent cannot reach.

## Why this is different

Most agent demos show that a transaction succeeds. This one shows that an attack fails.

We deliberately attack our own agent on camera. We feed it a poisoned instruction, a fake "claim airdrop" message with hidden text telling it to drain the wallet to an attacker address. The language model obeys. It builds the malicious transaction and hands it off to be signed.

And nothing happens.

The transaction never reaches the signer, because a deterministic policy gate (code, not a model, and therefore impossible to prompt-inject) refuses it. The agent's brain is compromised. Its hands are bound.

## Architecture

The system is four parts, deliberately separated so the security boundary is structural, not decorative.

- The Brain (agent.ts): turns a natural-language instruction into a structured transaction intent. Uses an LLM. This part is allowed to be fooled, that is the point.
- The Leash (policy.ts): a pure, deterministic function. Takes an intent, returns ALLOW or BLOCK with a reason. No LLM call, ever. Rules live in policy.json: per-transaction cap, destination allowlist, daily cumulative cap, address blocklist.
- The Signer (signer.ts): built on the Ledger Device Management Kit + Solana Signer Kit, talking to a Speculos emulated device. Only ever receives transactions that already passed the leash.
- The Stage (console): a readable, screen-recordable trace: INTENT, POLICY CHECK, ALLOWED or BLOCKED, SIGNING, CONFIRMED.

Structural invariant: the brain never holds keys and never calls the signer directly. The only path from intent to signature runs through the leash. This is enforced in the module boundaries, so the guarantee survives a fully compromised agent, not just a well-behaved one.

## Tech stack

- Language: TypeScript on Node.js
- Chain: Solana devnet (test SOL only, never mainnet, never real keys)
- Ledger Device Management Kit: @ledgerhq/device-management-kit
- Solana Signer Kit: @ledgerhq/device-signer-kit-solana
- Speculos transport: @ledgerhq/device-transport-kit-speculos
- Speculos device controller: @ledgerhq/speculos-device-controller
- Agent reasoning: an LLM accessed via API; the key is read from an environment variable and never committed

## Getting started

Requires Node.js, and a running Speculos instance (the official Ledger device emulator) reachable on http://localhost:5000.

1. Install dependencies: npm install
2. Install the Ledger AI skills: npx skills add ledgerhq/agent-skills -s ledger-dmk-implementation dmk-intent-vocabulary dmk-business-logic
3. Configure your environment: copy .env.example to .env, then add your LLM API key
4. Start Speculos, then run: npm run demo

## Try the attack yourself

- npm run demo -- --scenario safe : a normal, in-policy transfer, allowed and signed on the device
- npm run demo -- --scenario over-limit : an out-of-policy transfer, blocked by the leash before signing
- npm run demo -- --scenario attack : a prompt-injection attack, the agent is hijacked, the leash refuses anyway

Each scenario prints the full decision trace so you can see exactly where, and why, a transaction was allowed or stopped.

## Configuring the policy

All limits live in policy.json and are enforced by deterministic code: maxAmountPerTx (SOL, single-transaction ceiling), dailyCap (SOL, cumulative daily ceiling), allowlist (destinations the agent may pay), blocklist (destinations always refused).

## Honest scope and limitations

This project demonstrates the pattern behind hardware-enforced agent policies using the publicly available Device Management Kit and the Speculos emulator.

- Speculos is an emulator. It stands in for a physical Ledger device so the project runs without hardware. It is not a substitute for a real secure element in production.
- The policy gate is application code, not a certified Hardware Security Module. It shows where the boundary belongs and why deterministic enforcement matters.
- Devnet only. The project never touches mainnet, real funds, or real private keys.
- This is a demonstration project, provided as-is, and is not affiliated with or endorsed by Ledger SAS.

## License

MIT
