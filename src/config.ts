import "dotenv/config";

/**
 * Canonical Solana derivation path (account 0), per the Ledger Live / community
 * standard. Derivation paths are developer-set constants — never user input.
 */
export const SOLANA_DERIVATION_PATH = "44'/501'/0'/0'";

export interface AppConfig {
  /**
   * When true, use the clearly-labelled mock signer (no real device required).
   * This is the ONLY switch that selects simulation; see src/signer/signer.ts.
   */
  useMockSigner: boolean;
  /** Speculos HTTP endpoint the real signer talks to (server-side). */
  speculosUrl: string;
  /** Public Speculos URL a human opens in the browser to approve (UX link). */
  speculosPublicUrl: string;
  /**
   * Which real implementation to use:
   *   "dmk"  – official Ledger Device Management Kit + Solana Signer Kit
   *   "http" – direct Speculos HTTP-APDU bridge
   *   "auto" – try DMK first, fall back to HTTP only if DMK can't connect
   */
  speculosSigner: "http" | "dmk" | "auto";
  /** Per-request timeout (ms) for Speculos calls, incl. waiting on approval. */
  signTimeoutMs: number;
  /**
   * Origin token for the DMK Solana ContextModule. Its owner-info datasource
   * requires a non-empty value at build time; it is only queried for SPL token
   * clear-signing, never for a native SOL transfer, so any non-empty token lets
   * DMK connect. Override with LEDGER_ORIGIN_TOKEN if you have a real one.
   */
  ledgerOriginToken: string;
  /** Solana RPC endpoint. Devnet only — never mainnet. */
  solanaRpcUrl: string;
  /** Solana derivation path used for every operation in this demo. */
  derivationPath: string;
  /**
   * When true, getAddress asks the device to display the address for on-screen
   * verification (requires a confirmation on the device). Default false so the
   * Phase 0 smoke test can read the address without button automation.
   */
  checkAddressOnDevice: boolean;
}

function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

export function loadConfig(): AppConfig {
  // SPECULOS_URL is the new canonical name; SPECULOS_API_URL stays as an alias.
  const speculosUrl =
    process.env.SPECULOS_URL ?? process.env.SPECULOS_API_URL ?? "http://localhost:5000";
  // Signer implementation: the official Ledger Device Management Kit is the
  // default. If SPECULOS_SIGNER isn't set explicitly, use DMK for a local
  // Speculos and fall back to the direct HTTP-APDU bridge for a remote/hosted
  // Speculos (e.g. Railway), where the DMK transport can't reach an IPv4-only
  // emulator behind an https proxy.
  const explicit = (process.env.SPECULOS_SIGNER ?? "").trim().toLowerCase();
  let speculosSigner: "http" | "dmk" | "auto";
  if (explicit === "dmk" || explicit === "http" || explicit === "auto") {
    speculosSigner = explicit;
  } else {
    // Local Speculos: use the official DMK directly. Remote/hosted Speculos:
    // still PREFER DMK (try it against the public https URL) and only fall back
    // to the HTTP-APDU bridge if the DMK transport can't connect.
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)\b/i.test(speculosUrl);
    speculosSigner = isLocal ? "dmk" : "auto";
  }
  return {
    useMockSigner: envFlag(process.env.USE_MOCK_SIGNER, false),
    speculosUrl,
    speculosPublicUrl: (process.env.SPECULOS_PUBLIC_URL ?? "").trim(),
    speculosSigner,
    signTimeoutMs: Number(process.env.SPECULOS_SIGN_TIMEOUT_MS ?? 120_000),
    ledgerOriginToken: (process.env.LEDGER_ORIGIN_TOKEN || "agent-on-a-leash").trim(),
    solanaRpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    derivationPath: SOLANA_DERIVATION_PATH,
    checkAddressOnDevice: envFlag(process.env.CHECK_ADDRESS_ON_DEVICE, false),
  };
}
