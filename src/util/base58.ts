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
