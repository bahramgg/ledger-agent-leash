import type { AppConfig } from "../config.js";
import type { LeashSigner, SignerAddress, SignerSignature } from "./signer.js";
import { toBase58 } from "../util/base58.js";

/**
 * REAL signing path — direct Speculos HTTP APDU.
 *
 * Instead of the Device Management Kit transport, this talks to the Speculos
 * REST API directly: `POST {SPECULOS_URL}/apdu` with `{"data":"<apduHex>"}`,
 * whose reply hex ends with the status word (0x9000 on success). This is the
 * robust path for a remote/hosted Speculos, where the DMK kits' transport
 * assumptions don't always hold in a plain Node runtime.
 *
 * It implements exactly the Ledger Solana app APDUs (verified against
 * @ledgerhq/device-signer-kit-solana):
 *   - GET_PUBKEY  CLA 0xE0 INS 0x05 P1 confirm P2 0x00, data = path
 *   - SIGN        CLA 0xE0 INS 0x06 P1 0x01 P2 flags,    data = [1][path][msg]
 * Solana signatures are ed25519, 64 bytes, shown base58 — never hex.
 *
 * It never returns a value the device did not produce: a non-0x9000 status word
 * or a wrong-length field throws with the real detail.
 */

const CLA = 0xe0;
const INS_GET_PUBKEY = 0x05;
const INS_SIGN = 0x06;
const SIGN_P1 = 0x01;
const FLAG_MORE = 0x02;
const FLAG_EXTEND = 0x01;
const APDU_MAX_PAYLOAD = 255;
const PUBKEY_LEN = 32;
const SIGNATURE_LEN = 64;
const HARDENED = 0x80000000;

/** Split "44'/501'/0'/0'" into hardened 32-bit path components. */
function splitPath(path: string): number[] {
  return path.split("/").map((part) => {
    const hardened = part.endsWith("'") || part.endsWith("h");
    const n = Number.parseInt(hardened ? part.slice(0, -1) : part, 10);
    if (Number.isNaN(n)) throw new Error(`Invalid derivation path segment "${part}"`);
    return hardened ? (n + HARDENED) >>> 0 : n >>> 0;
  });
}

/** Encode path components as [count][c0 BE][c1 BE]… */
function encodePath(path: string): number[] {
  const parts = splitPath(path);
  const out: number[] = [parts.length];
  for (const c of parts) {
    out.push((c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff);
  }
  return out;
}

function toHex(bytes: number[] | Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function createSpeculosHttpSigner(config: AppConfig): LeashSigner {
  const base = config.speculosUrl.replace(/\/+$/, "");
  const apduUrl = `${base}/apdu`;
  // SPECULOS_DEBUG=true logs every APDU request/response to the server console.
  const debug = process.env.SPECULOS_DEBUG === "true" || process.env.SPECULOS_DEBUG === "1";

  /** POST one APDU, return the response payload (status word stripped). */
  async function exchange(apdu: number[]): Promise<Uint8Array> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.signTimeoutMs);
    let res: Response;
    try {
      res = await fetch(apduUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: toHex(apdu) }),
        signal: ctrl.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `Speculos at ${base} did not respond within ${config.signTimeoutMs}ms ` +
            `(was the transaction approved in the Speculos UI?).`,
        );
      }
      throw new Error(
        `Could not reach Speculos at ${apduUrl}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`Speculos /apdu returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as { data?: string; error?: string };
    if (debug) {
      console.log(`[speculos] APDU > ${toHex(apdu)}`);
      console.log(`[speculos] APDU < ${json.data ?? "(no data)"}`);
    }
    if (!json.data) {
      throw new Error(`Speculos /apdu gave no data${json.error ? `: ${json.error}` : ""}`);
    }
    const reply = fromHex(json.data);
    if (reply.length < 2) throw new Error("Speculos reply too short for a status word");
    const sw = (reply[reply.length - 2]! << 8) | reply[reply.length - 1]!;
    if (sw !== 0x9000) {
      const hex = `0x${sw.toString(16).padStart(4, "0")}`;
      // 0x6985 = user rejected on device; 0x6a81 = couldn't clear-sign/parse the
      // transaction (a malformed message or unusual app build — NOT normal for a
      // plain transfer, which clear-signs). Everything else: surface the raw code.
      let detail = "";
      if (sw === 0x6985) detail = " The transaction was rejected on the device.";
      else if (sw === 0x6a81)
        detail =
          " The app couldn't clear-sign this transaction (it expected a parseable" +
          " transfer). This usually means a malformed message or an unusual app build.";
      throw new Error(`Ledger Solana app returned status ${hex}.${detail}`);
    }
    return reply.slice(0, reply.length - 2);
  }

  return {
    kind: "speculos",

    async getAddress(): Promise<SignerAddress> {
      const p1 = config.checkAddressOnDevice ? 0x01 : 0x00;
      const data = encodePath(config.derivationPath);
      const apdu = [CLA, INS_GET_PUBKEY, p1, 0x00, data.length, ...data];
      const payload = await exchange(apdu);
      if (payload.length < PUBKEY_LEN) {
        throw new Error(`Public key response too short (${payload.length} bytes)`);
      }
      const pubkey = payload.slice(0, PUBKEY_LEN);
      return { address: toBase58(pubkey), derivationPath: config.derivationPath };
    },

    async signTransaction(messageBytes: Uint8Array): Promise<SignerSignature> {
      // Payload the app signs: [numSigners=1][path][serialized message].
      const path = encodePath(config.derivationPath);
      const payload = new Uint8Array(1 + path.length + messageBytes.length);
      payload[0] = 1;
      payload.set(path, 1);
      payload.set(messageBytes, 1 + path.length);

      if (debug) {
        console.log(`[speculos] sign message (${messageBytes.length} bytes): ${toHex(messageBytes)}`);
        console.log(`[speculos] sign payload (${payload.length} bytes): ${toHex(payload)}`);
      }

      // Chunk to APDU_MAX_PAYLOAD with more/extend flags, exactly like the kit.
      let signature: Uint8Array | null = null;
      for (let offset = 0; offset < payload.length; offset += APDU_MAX_PAYLOAD) {
        const chunk = payload.slice(offset, offset + APDU_MAX_PAYLOAD);
        const isLast = offset + APDU_MAX_PAYLOAD >= payload.length;
        let p2 = 0;
        if (!isLast) p2 |= FLAG_MORE;
        if (offset > 0) p2 |= FLAG_EXTEND;
        const apdu = [CLA, INS_SIGN, SIGN_P1, p2, chunk.length, ...chunk];
        const out = await exchange(apdu);
        if (isLast) signature = out;
      }

      if (!signature || signature.length !== SIGNATURE_LEN) {
        const len = signature ? signature.length : 0;
        const hex = signature ? toHex(signature) : "";
        const ascii = signature
          ? Array.from(signature)
              .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
              .join("")
          : "";
        if (debug) console.error(`[speculos] bad signature: ${len} bytes, raw=0x${hex} ascii="${ascii}"`);
        throw new Error(
          `Expected a ${SIGNATURE_LEN}-byte signature but the device returned ${len} bytes ` +
            `(status 0x9000): raw=0x${hex}${ascii ? ` ascii="${ascii}"` : ""}. ` +
            `The Solana app returned data instead of a signature for this transaction.`,
        );
      }
      return { signature, signatureBase58: toBase58(signature) };
    },

    async disconnect(): Promise<void> {
      // Stateless HTTP — nothing to release.
    },
  };
}
