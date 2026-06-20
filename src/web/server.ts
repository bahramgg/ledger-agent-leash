import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

import { loadConfig } from "../config.js";
import { evaluatePolicy, type Policy, type TransactionIntent } from "../policy.js";
import { createSigner, type LeashSigner } from "../signer/signer.js";
import { buildTransferMessage } from "../transaction.js";

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
  if (evaluation.decision === "ALLOW") {
    const signer = await getSigner();
    const from = (await signer.getAddress()).address;
    const message = buildTransferMessage(intent, from);
    signature = (await signer.signTransaction(message)).signatureBase58;
    deviceInvoked = true;
    signerKind = signer.kind;
  }

  return {
    proposed: { amount, destination, token: "SOL", compromised },
    checks,
    verdict: evaluation.decision,
    reason: evaluation.reason,
    signature,
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
