/**
 * TOTP (Time-based One-Time Password) — RFC 6238
 *
 * Uses Node.js crypto for HMAC-SHA1 generation.
 * No external dependencies.
 */

import { createHmac, randomBytes } from 'node:crypto';

const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const RECOVERY_CODE_COUNT = 10;

/**
 * Generate a random base32-encoded TOTP secret
 */
export function generateTOTPSecret(length = 20): string {
  const bytes = randomBytes(length);
  return base32Encode(bytes);
}

/**
 * Generate a TOTP code for the given secret and time
 */
export function generateTOTP(secret: string, timeMs?: number): string {
  const time = timeMs ?? Date.now();
  const counter = Math.floor(time / 1000 / TOTP_PERIOD);
  return hotpGenerate(base32Decode(secret), counter);
}

/**
 * Verify a TOTP code, allowing for +-1 time step drift
 */
export function verifyTOTP(secret: string, code: string, timeMs?: number): boolean {
  const time = timeMs ?? Date.now();
  const counter = Math.floor(time / 1000 / TOTP_PERIOD);

  // Check current, previous, and next time steps to handle clock drift
  for (let offset = -1; offset <= 1; offset++) {
    const expected = hotpGenerate(base32Decode(secret), counter + offset);
    if (constantTimeEqual(expected, code)) {
      return true;
    }
  }
  return false;
}

/**
 * Generate recovery codes (one-time backup codes)
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(5);
    codes.push(bytes.toString('hex').toUpperCase());
  }
  return codes;
}

/**
 * Build a standard otpauth:// URI for QR code generation
 */
export function buildTOTPUri(secret: string, account: string, issuer = 'SecureYeoman'): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${params.toString()}`;
}

// ── HOTP (RFC 4226) ─────────────────────────────────────────────

function hotpGenerate(key: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

// ── Base32 ───────────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

// ── Constant-time comparison ────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
