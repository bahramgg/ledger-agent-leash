import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

import { loadConfig } from "../config.js";
import { evaluatePolicy, type Policy, type TransactionIntent } from "../policy.js";
import { createSigner, type LeashSigner } from "../signer/signer.js";
import {
  buildTransferMessage,
  buildSolanaTransferMessage,
  fetchRecentBlockhash,
  solToLamports,
} from "../transaction.js";

/**
 * Minimal web server for the dashboard.
 *
 * - Serves the static dashboard from public/.
 * - POST /api/run runs the REAL flow: the agent proposes an intent, THE LEASH
 *   (src/policy.ts — the same module the CLI uses) evaluates it, and the signer
 *   signs ONLY if the leash approves. No rule logic is duplicated here.
 */

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = resolve(process.cwd(), "public");
const config = loadConfig();

// A real ed25519 signature captured from Speculos at dev/build time. Speculos
// can't run on a typical public host, so when the live signer is the mock we
// display this captured-real signature instead, clearly labelled. Paste yours
// (base58) into SPECULOS_SIGNATURE; see docs/speculos.md + DEPLOY.md.
const CAPTURED_SIGNATURE = (process.env.SPECULOS_SIGNATURE ?? "").trim();
const CAPTURED_SIGNATURE_NOTE = (process.env.SPECULOS_SIGNATURE_NOTE ?? "").trim();

// One signer (and one device session) reused across requests.
let signerPromise: Promise<LeashSigner> | null = null;
function getSigner(): Promise<LeashSigner> {
  if (!signerPromise) signerPromise = createSigner(config);
  return signerPromise;
}

interface RunRequest {
  amount?: number | string;
  destination?: string;
  cap?: number | string;
  allowlist?: string | string[];
  compromised?: boolean;
}

function num(value: unknown, fallback = Number.NaN): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

function toAllowlist(value: RunRequest["allowlist"]): string[] {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim() !== "") return [value.trim()];
  return [];
}

async function handleRun(body: RunRequest) {
  const amount = num(body.amount);
  const destination = (body.destination ?? "").trim();
  const compromised = Boolean(body.compromised);

  // The dashboard policy is cap + allowlist only (no daily cap / blocklist),
  // so those rules are inert here while staying the same engine.
  const policy: Policy = {
    maxAmountPerTx: num(body.cap, 0),
    dailyCap: Number.POSITIVE_INFINITY,
    allowlist: toAllowlist(body.allowlist),
    blocklist: [],
  };

  // The agent proposes this intent. When `compromised` is true, the proposal is
  // attacker-controlled — but it still has to clear the leash like anything else.
  const intent: TransactionIntent = { destination, amountSol: amount, token: "SOL" };

  // THE LEASH — the single, shared rule engine.
  const evaluation = evaluatePolicy(intent, policy, 0);

  // Surface only the two rules the dashboard renders, cap first.
  const order = ["maxAmountPerTx", "allowlist"];
  const checks = evaluation.checks
    .filter((c) => order.includes(c.id))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((c) => ({ id: c.id, rule: c.rule, pass: c.pass, detail: c.detail }));

  // THE SIGNER — reached only when the leash approves.
  let signature: string | null = null;
  let deviceInvoked = false;
  let signerKind: LeashSigner["kind"] | null = null;
  // How to label the signature in the UI: a live device sig, a real one captured
  // from Speculos earlier, or the simulated mock sig.
  let signatureKind: "speculos-live" | "speculos-captured" | "mock" | null = null;
  let signatureNote = "";

  if (evaluation.decision === "ALLOW") {
    const signer = await getSigner();
    const from = (await signer.getAddress()).address;
    // Real path signs the ACTUAL serialized Solana transfer (recent blockhash
    // from RPC). Mock path keeps the lightweight placeholder bytes.
    let message: Uint8Array;
    if (signer.kind === "speculos") {
      const recentBlockhashBase58 = await fetchRecentBlockhash(config.solanaRpcUrl);
      message = buildSolanaTransferMessage({
        fromBase58: from,
        toBase58: destination,
        lamports: solToLamports(amount),
        recentBlockhashBase58,
      });
    } else {
      message = buildTransferMessage(intent, from);
    }
    const liveSig = (await signer.signTransaction(message)).signatureBase58;
    deviceInvoked = true;
    signerKind = signer.kind;

    if (signer.kind === "speculos") {
      signature = liveSig;
      signatureKind = "speculos-live";
      signatureNote = "Signed live on the Speculos-emulated Ledger device.";
    } else if (CAPTURED_SIGNATURE) {
      signature = CAPTURED_SIGNATURE;
      signatureKind = "speculos-captured";
      signatureNote =
        CAPTURED_SIGNATURE_NOTE ||
        "Real ed25519 signature captured from Speculos at dev/build time (sample transfer). " +
          "The live signer on this host is the mock.";
    } else {
      signature = liveSig;
      signatureKind = "mock";
      signatureNote = "Simulated signature — run against Speculos for a real one.";
    }
  }

  return {
    proposed: { amount, destination, token: "SOL", compromised },
    checks,
    verdict: evaluation.decision,
    reason: evaluation.reason,
    signature,
    signatureKind,
    signatureNote,
    deviceInvoked,
    signerKind,
  };
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

async function serveStatic(rawUrl: string, res: import("node:http").ServerResponse): Promise<void> {
  let pathname = decodeURIComponent(new URL(rawUrl, "http://localhost").pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + "/")) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/run") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      let body: RunRequest;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as RunRequest;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON body" }));
        return;
      }
      const result = await handleRun(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.method === "GET" && req.url === "/api/address") {
      // The real device's own Solana address (its GET_PUBKEY). Lets the dashboard
      // pre-fill a genuine 32-byte address in real mode so signing "just works".
      try {
        const signer = await getSigner();
        const { address } = await signer.getAddress();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ address, signerKind: signer.kind }));
      } catch (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
      return;
    }

    if (req.method === "GET" && req.url === "/api/mode") {
      // Tells the dashboard whether a live device approval is expected and where
      // to approve it. `real` is true only when the live signer is Speculos.
      const real = !config.useMockSigner;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          real,
          signerImpl: real ? config.speculosSigner : "mock",
          speculosPublicUrl: config.speculosPublicUrl,
          hasCapturedSignature: Boolean(CAPTURED_SIGNATURE),
        }),
      );
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req.url ?? "/", res);
      return;
    }

    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method not allowed");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
});

server.listen(PORT, () => {
  const mode = config.useMockSigner ? "MOCK signer" : `Speculos @ ${config.speculosUrl}`;
  console.log(`Agent on a Leash — web server on http://localhost:${PORT}  (${mode})`);
});
