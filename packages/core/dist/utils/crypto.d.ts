/**
 * Cryptographic Utilities for SecureClaw
 *
 * Security considerations:
 * - Uses Node.js built-in crypto module (FIPS-compliant)
 * - Constant-time comparison for signatures to prevent timing attacks
 * - Secure random generation for IDs and keys
 * - No custom crypto implementations
 */
/**
 * Generate a SHA-256 hash of the input
 * Used for hashing task inputs/outputs (not for passwords)
 */
export declare function sha256(data: string | Buffer): string;
/**
 * Generate an HMAC-SHA256 signature
 * Used for audit chain integrity
 */
export declare function hmacSha256(data: string | Buffer, key: string | Buffer): string;
/**
 * Constant-time comparison of two strings/buffers
 * Prevents timing attacks when comparing signatures
 */
export declare function secureCompare(a: string | Buffer, b: string | Buffer): boolean;
/**
 * Generate cryptographically secure random bytes as hex string
 */
export declare function randomHex(bytes: number): string;
/**
 * Generate a UUID v7 (time-sortable)
 * Based on RFC 9562 draft
 */
export declare function uuidv7(): string;
/**
 * Generate a secure random token for session/API keys
 */
export declare function generateSecureToken(bytes?: number): string;
/**
 * Sanitize a string for safe logging (remove potential secrets)
 * This is a basic implementation - should be enhanced based on use case
 */
export declare function sanitizeForLogging(input: unknown): unknown;
//# sourceMappingURL=crypto.d.ts.map