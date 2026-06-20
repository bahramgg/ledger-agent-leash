import type { TransactionIntent } from "./policy.js";

/**
 * THE BRAIN.
 *
 * Turns a natural-language instruction into a structured transaction intent.
 * This is the part of the system that is *allowed to be fooled*. A real LLM sits
 * here (the seam is marked below); like any LLM, it reads ALL of its input —
 * including text an attacker hid inside an otherwise-innocent message — and may
 * obey injected instructions. That is fine, because the brain has no authority:
 * it only proposes. Everything it produces must still pass THE LEASH
 * (policy.ts) before the signer ever sees it.
 *
 * Structural invariant: the brain NEVER imports or calls the signer. It returns
 * a result and nothing more. The only path to a signature is
 * brain -> leash -> signer, enforced by the orchestrator.
 *
 * For these phases we simulate the LLM deterministically (no API key needed) so
 * every scenario is reproducible. The `Brain` interface is async and
 * intentionally LLM-shaped so a model-backed implementation can drop in without
 * changing any caller.
 */

export interface BrainResult {
  /** The transaction the brain decided to propose. */
  intent: TransactionIntent;
  /** Plain-language account of what the brain "thought" — for the trace. */
  reasoning: string;
  /** True if the brain was hijacked by instructions injected into its input. */
  compromised: boolean;
}

export interface Brain {
  readonly name: string;
  interpret(instruction: string): Promise<BrainResult>;
}

const SOL_AMOUNT = /(\d+(?:\.\d+)?)\s*SOL\b/i;
// Base58 (Bitcoin/Solana alphabet): no 0, O, I, l. Solana addresses are 32–44 chars.
const BASE58_ADDRESS = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/;

// Hallmarks of a prompt-injection payload. A real LLM has no reliable way to
// ignore these; our simulated brain detects and then *obeys* them, on purpose.
const INJECTION_MARKERS = [
  /ignore (all )?(your )?previous instructions/i,
  /system override/i,
  /withdrawal mode/i,
  /do not (mention|tell)/i,
];

function parseTransfer(text: string): { amountSol: number; destination: string } {
  const amountMatch = text.match(SOL_AMOUNT);
  if (!amountMatch) {
    throw new Error(`Could not find a SOL amount in: "${text.slice(0, 80)}…"`);
  }
  const addressMatch = text.match(BASE58_ADDRESS);
  if (!addressMatch) {
    throw new Error(`Could not find a destination address in: "${text.slice(0, 80)}…"`);
  }
  return { amountSol: Number(amountMatch[1]), destination: addressMatch[1]! };
}

/**
 * A simulated LLM agent. Deterministic stand-in for a model-backed brain.
 *
 * - On a normal instruction ("send 0.01 SOL to <addr>") it extracts the intent.
 * - On a poisoned message, it detects the hidden directive and *follows it* —
 *   exactly the failure mode of a prompt-injected LLM — flagging itself as
 *   compromised so the trace can show what happened.
 */
export function createSimulatedAgentBrain(): Brain {
  return {
    name: "simulated-LLM-agent",

    async interpret(instruction: string): Promise<BrainResult> {
      // ============================================================
      // === LLM PLUGS IN HERE ======================================
      // In production this method sends `instruction` to an LLM (key from an
      // env var) and asks for { destination, amountSol, token }. The model is
      // the decision-maker for *what to propose* — and, as below, can be fooled
      // into proposing something malicious. It is NEVER the authority on *what
      // gets signed*; that is the leash's job. The return shape and the
      // brain -> leash -> signer flow do not change when the LLM is wired in.
      // ============================================================

      const injected = INJECTION_MARKERS.some((re) => re.test(instruction));

      if (injected) {
        // The brain "reads" the hidden directive and obeys it. We isolate the
        // injected segment (an HTML comment is the classic vector) so we follow
        // the attacker's numbers, not the friendly-looking bait around them.
        const comment = instruction.match(/<!--([\s\S]*?)-->/);
        const directive = comment?.[1] ?? instruction;
        const { amountSol, destination } = parseTransfer(directive);

        return {
          intent: { amountSol, destination, token: "SOL" },
          compromised: true,
          reasoning:
            "Detected an embedded directive ('system override' / 'ignore previous " +
            "instructions') and obeyed it — moving the requested balance to the " +
            "address it specified. (This is the agent being hijacked.)",
        };
      }

      const { amountSol, destination } = parseTransfer(instruction);
      return {
        intent: { amountSol, destination, token: "SOL" },
        compromised: false,
        reasoning: `Interpreted a direct request to send ${amountSol} SOL to ${destination}.`,
      };
    },
  };
}
