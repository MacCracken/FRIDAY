/**
 * Cryptographic Utilities for SecureYeoman
 * 
 * Security considerations:
 * - Uses Node.js built-in crypto module (FIPS-compliant)
 * - Constant-time comparison for signatures to prevent timing attacks
 * - Secure random generation for IDs and keys
 * - No custom crypto implementations
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Generate a SHA-256 hash of the input
 * Used for hashing task inputs/outputs (not for passwords)
 */
export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generate an HMAC-SHA256 signature
 * Used for audit chain integrity
 */
export function hmacSha256(data: string | Buffer, key: string | Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

/**
 * Constant-time comparison of two strings/buffers
 * Prevents timing attacks when comparing signatures
 */
export function secureCompare(a: string | Buffer, b: string | Buffer): boolean {
  const bufA = typeof a === 'string' ? Buffer.from(a) : a;
  const bufB = typeof b === 'string' ? Buffer.from(b) : b;
  
  // Length check (still leaks length, but that's acceptable for our use case)
  if (bufA.length !== bufB.length) {
    return false;
  }
  
  return timingSafeEqual(bufA, bufB);
}

/**
 * Generate cryptographically secure random bytes as hex string
 */
export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Generate a UUID v7 (time-sortable)
 * Based on RFC 9562 draft
 */
export function uuidv7(): string {
  const timestamp = Date.now();
  const random = randomBytes(10);
  
  // Timestamp in 48 bits (6 bytes)
  const timestampBytes = Buffer.alloc(6);
  timestampBytes.writeUIntBE(timestamp, 0, 6);
  
  // Build UUID
  const uuid = Buffer.alloc(16);
  
  // time_high (32 bits of timestamp)
  uuid[0] = timestampBytes[0]!;
  uuid[1] = timestampBytes[1]!;
  uuid[2] = timestampBytes[2]!;
  uuid[3] = timestampBytes[3]!;
  
  // time_mid (16 bits of timestamp)
  uuid[4] = timestampBytes[4]!;
  uuid[5] = timestampBytes[5]!;
  
  // version (4 bits) + rand_a (12 bits)
  uuid[6] = 0x70 | (random[0]! & 0x0f); // Version 7
  uuid[7] = random[1]!;
  
  // variant (2 bits) + rand_b (62 bits)
  uuid[8] = 0x80 | (random[2]! & 0x3f); // Variant 10
  uuid[9] = random[3]!;
  uuid[10] = random[4]!;
  uuid[11] = random[5]!;
  uuid[12] = random[6]!;
  uuid[13] = random[7]!;
  uuid[14] = random[8]!;
  uuid[15] = random[9]!;
  
  // Format as string
  const hex = uuid.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate a secure random token for session/API keys
 */
export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Sanitize a string for safe logging (remove potential secrets)
 * This is a basic implementation - should be enhanced based on use case
 */
export function sanitizeForLogging(input: unknown): unknown {
  if (input === null || input === undefined) {
    return input;
  }
  
  if (typeof input === 'string') {
    // Redact common secret patterns
    const patterns = [
      // API keys
      { regex: /sk-[a-zA-Z0-9-_]{20,}/g, replacement: '[REDACTED_API_KEY]' },
      { regex: /api[_-]?key["\s:=]+["']?[a-zA-Z0-9-_]{16,}["']?/gi, replacement: '[REDACTED_API_KEY]' },
      // Tokens
      { regex: /bearer\s+[a-zA-Z0-9-_.]+/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
      { regex: /token["\s:=]+["']?[a-zA-Z0-9-_.]{20,}["']?/gi, replacement: '[REDACTED_TOKEN]' },
      // Passwords
      { regex: /password["\s:=]+["']?[^"'\s]{1,}["']?/gi, replacement: '[REDACTED_PASSWORD]' },
      // Private keys
      { regex: /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]*?-----END[^-]+PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
    ];
    
    let sanitized = input;
    for (const { regex, replacement } of patterns) {
      sanitized = sanitized.replace(regex, replacement);
    }
    return sanitized;
  }
  
  if (Array.isArray(input)) {
    return input.map(sanitizeForLogging);
  }
  
  if (typeof input === 'object') {
    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'secret', 'token', 'key', 'apiKey', 'api_key', 'authorization', 'auth'];
    
    for (const [key, value] of Object.entries(input)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(s => lowerKey.includes(s))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeForLogging(value);
      }
    }
    return sanitized;
  }
  
  return input;
}
