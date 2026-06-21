/**
 * Minimal Base58 encoder (Bitcoin/Solana alphabet).
 *
 * Solana public keys and signatures are conventionally shown as Base58 strings.
 * We keep a tiny dependency-free encoder here so both the real signer (to render
 * a raw signature) and the mock signer (to fake one) format output identically.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function toBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Preserve leading zero bytes — each maps to a leading "1".
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // Convert the base-256 number to base-58 by repeated division.
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    out += ALPHABET[digits[i]!];
  }
  return out;
}

/** Reverse map from Base58 character to its 0–57 value, built once. */
const INDEX: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) m[ALPHABET[i]!] = i;
  return m;
})();

/**
 * Minimal Base58 decoder (Bitcoin/Solana alphabet). Inverse of {@link toBase58}.
 *
 * Used by the REAL signer path to turn base58 Solana addresses / blockhashes
 * (the device pubkey, the destination, the recent blockhash) back into the raw
 * 32-byte values needed to serialize a Solana transfer message. Throws on any
 * character outside the alphabet so a bad address fails loudly, never silently.
 */
export function fromBase58(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);

  // Leading "1"s are leading zero bytes.
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;

  const bytes: number[] = [];
  for (let i = zeros; i < str.length; i++) {
    const value = INDEX[str[i]!];
    if (value === undefined) {
      throw new Error(`Invalid Base58 character "${str[i]}" at position ${i}`);
    }
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + bytes.length - 1 - i] = bytes[i]!;
  return out;
}

