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
  /** Speculos HTTP endpoint the real signer talks to. */
  speculosUrl: string;
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
  return {
    useMockSigner: envFlag(process.env.USE_MOCK_SIGNER, false),
    speculosUrl: process.env.SPECULOS_API_URL ?? "http://localhost:5000",
    solanaRpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    derivationPath: SOLANA_DERIVATION_PATH,
    checkAddressOnDevice: envFlag(process.env.CHECK_ADDRESS_ON_DEVICE, false),
  };
}
