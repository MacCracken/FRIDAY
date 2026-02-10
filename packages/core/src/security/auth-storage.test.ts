import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthStorage } from './auth-storage.js';
import { sha256, uuidv7 } from '../utils/crypto.js';

describe('AuthStorage', () => {
  let storage: AuthStorage;

  beforeEach(() => {
    storage = new AuthStorage(); // :memory:
  });

  afterEach(() => {
    storage.close();
  });

  // ── Token revocation ──────────────────────────────────────────────

  describe('token revocation', () => {
    it('should report a token as not revoked when absent', () => {
      expect(storage.isTokenRevoked('nonexistent-jti')).toBe(false);
    });

    it('should revoke a token and report it as revoked', () => {
      const jti = uuidv7();
      storage.revokeToken(jti, 'admin', Date.now() + 3600_000);
      expect(storage.isTokenRevoked(jti)).toBe(true);
    });

    it('should handle duplicate revocation gracefully (INSERT OR IGNORE)', () => {
      const jti = uuidv7();
      const exp = Date.now() + 3600_000;
      storage.revokeToken(jti, 'admin', exp);
      storage.revokeToken(jti, 'admin', exp); // should not throw
      expect(storage.isTokenRevoked(jti)).toBe(true);
    });
  });

  // ── Expired token cleanup ─────────────────────────────────────────

  describe('cleanupExpiredTokens', () => {
    it('should delete tokens whose expires_at is in the past', () => {
      const jti1 = uuidv7();
      const jti2 = uuidv7();
      // jti1 expired
      storage.revokeToken(jti1, 'admin', Date.now() - 1000);
      // jti2 still valid
      storage.revokeToken(jti2, 'admin', Date.now() + 3600_000);

      const cleaned = storage.cleanupExpiredTokens();
      expect(cleaned).toBe(1);
      expect(storage.isTokenRevoked(jti1)).toBe(false);
      expect(storage.isTokenRevoked(jti2)).toBe(true);
    });

    it('should return 0 when nothing to clean', () => {
      expect(storage.cleanupExpiredTokens()).toBe(0);
    });
  });

  // ── API key CRUD ──────────────────────────────────────────────────

  describe('API keys', () => {
    const makeRow = (overrides: Partial<Parameters<AuthStorage['storeApiKey']>[0]> = {}) => ({
      id: overrides.id ?? uuidv7(),
      name: overrides.name ?? 'test-key',
      key_hash: overrides.key_hash ?? sha256('sck_testkey123'),
      key_prefix: overrides.key_prefix ?? 'sck_test',
      role: overrides.role ?? 'admin',
      user_id: overrides.user_id ?? 'admin',
      created_at: overrides.created_at ?? Date.now(),
      expires_at: overrides.expires_at ?? null,
      revoked_at: overrides.revoked_at ?? null,
      last_used_at: overrides.last_used_at ?? null,
    });

    it('should store and retrieve a key by hash', () => {
      const row = makeRow();
      storage.storeApiKey(row);
      const found = storage.findApiKeyByHash(row.key_hash);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(row.id);
      expect(found!.name).toBe('test-key');
    });

    it('should return null for unknown hash', () => {
      expect(storage.findApiKeyByHash('nonexistent')).toBeNull();
    });

    it('should not return a revoked key', () => {
      const row = makeRow({ revoked_at: Date.now() });
      storage.storeApiKey(row);
      expect(storage.findApiKeyByHash(row.key_hash)).toBeNull();
    });

    it('should not return an expired key', () => {
      const row = makeRow({ expires_at: Date.now() - 1000 });
      storage.storeApiKey(row);
      expect(storage.findApiKeyByHash(row.key_hash)).toBeNull();
    });

    it('should list keys for a specific user', () => {
      storage.storeApiKey(makeRow({ id: uuidv7(), key_hash: sha256('a'), user_id: 'alice' }));
      storage.storeApiKey(makeRow({ id: uuidv7(), key_hash: sha256('b'), user_id: 'bob' }));
      storage.storeApiKey(makeRow({ id: uuidv7(), key_hash: sha256('c'), user_id: 'alice' }));

      const aliceKeys = storage.listApiKeys('alice');
      expect(aliceKeys).toHaveLength(2);
      expect(aliceKeys.every((k) => k.user_id === 'alice')).toBe(true);
      // Should not contain key_hash
      expect((aliceKeys[0] as Record<string, unknown>).key_hash).toBeUndefined();
    });

    it('should list all keys without userId filter', () => {
      storage.storeApiKey(makeRow({ id: uuidv7(), key_hash: sha256('a'), user_id: 'alice' }));
      storage.storeApiKey(makeRow({ id: uuidv7(), key_hash: sha256('b'), user_id: 'bob' }));

      const keys = storage.listApiKeys();
      expect(keys).toHaveLength(2);
    });

    it('should revoke a key', () => {
      const row = makeRow();
      storage.storeApiKey(row);

      const ok = storage.revokeApiKey(row.id);
      expect(ok).toBe(true);
      expect(storage.findApiKeyByHash(row.key_hash)).toBeNull();
    });

    it('should return false when revoking a non-existent key', () => {
      expect(storage.revokeApiKey('nonexistent')).toBe(false);
    });

    it('should update last_used_at', () => {
      const row = makeRow();
      storage.storeApiKey(row);

      const now = Date.now();
      storage.updateLastUsed(row.id, now);

      const found = storage.findApiKeyByHash(row.key_hash);
      expect(found!.last_used_at).toBe(now);
    });
  });
});
