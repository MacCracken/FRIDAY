/**
 * Secret Management for SecureClaw
 * 
 * Security considerations:
 * - AES-256-GCM encryption for secrets at rest
 * - Unique IV (nonce) for each encryption operation
 * - Key derivation using scrypt for password-based keys
 * - Secrets are never logged or exposed in stack traces
 * - Memory is cleared after use where possible
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getLogger, type SecureLogger } from '../logging/logger.js';

// Encryption constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;
const KEY_LENGTH = 32; // 256 bits
const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_R = 8; // Block size
const SCRYPT_P = 1; // Parallelization

// Magic bytes to identify encrypted files
const MAGIC_BYTES = Buffer.from('SCLW'); // SecureCLaW

export interface EncryptedData {
  /** Version for future format changes */
  version: number;
  /** Salt used for key derivation */
  salt: Buffer;
  /** Initialization vector */
  iv: Buffer;
  /** Authentication tag */
  authTag: Buffer;
  /** Encrypted data */
  ciphertext: Buffer;
}

export interface SecretStoreConfig {
  /** Path to the encrypted secrets file */
  storePath: string;
  /** Master key (from environment or hardware) */
  masterKey: string;
}

/**
 * Derive an encryption key from a password using scrypt
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(plaintext: string | Buffer, masterKey: string): EncryptedData {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(masterKey, salt);
  const iv = randomBytes(IV_LENGTH);
  
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  
  const plaintextBuffer = typeof plaintext === 'string' 
    ? Buffer.from(plaintext, 'utf-8') 
    : plaintext;
  
  const ciphertext = Buffer.concat([
    cipher.update(plaintextBuffer),
    cipher.final(),
  ]);
  
  const authTag = cipher.getAuthTag();
  
  // Clear the key from memory
  key.fill(0);
  
  return {
    version: 1,
    salt,
    iv,
    authTag,
    ciphertext,
  };
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(encrypted: EncryptedData, masterKey: string): Buffer {
  const key = deriveKey(masterKey, encrypted.salt);
  
  const decipher = createDecipheriv(ALGORITHM, key, encrypted.iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  
  decipher.setAuthTag(encrypted.authTag);
  
  try {
    const plaintext = Buffer.concat([
      decipher.update(encrypted.ciphertext),
      decipher.final(),
    ]);
    
    return plaintext;
  } finally {
    // Clear the key from memory
    key.fill(0);
  }
}

/**
 * Serialize encrypted data to a buffer for storage
 */
export function serializeEncrypted(data: EncryptedData): Buffer {
  // Format: MAGIC(4) + VERSION(1) + SALT_LEN(1) + SALT + IV_LEN(1) + IV + TAG_LEN(1) + TAG + CIPHERTEXT
  const buffer = Buffer.alloc(
    MAGIC_BYTES.length + 
    1 + // version
    1 + data.salt.length +
    1 + data.iv.length +
    1 + data.authTag.length +
    data.ciphertext.length
  );
  
  let offset = 0;
  
  // Magic bytes
  MAGIC_BYTES.copy(buffer, offset);
  offset += MAGIC_BYTES.length;
  
  // Version
  buffer.writeUInt8(data.version, offset);
  offset += 1;
  
  // Salt
  buffer.writeUInt8(data.salt.length, offset);
  offset += 1;
  data.salt.copy(buffer, offset);
  offset += data.salt.length;
  
  // IV
  buffer.writeUInt8(data.iv.length, offset);
  offset += 1;
  data.iv.copy(buffer, offset);
  offset += data.iv.length;
  
  // Auth tag
  buffer.writeUInt8(data.authTag.length, offset);
  offset += 1;
  data.authTag.copy(buffer, offset);
  offset += data.authTag.length;
  
  // Ciphertext (remaining bytes)
  data.ciphertext.copy(buffer, offset);
  
  return buffer;
}

/**
 * Deserialize encrypted data from a buffer
 */
export function deserializeEncrypted(buffer: Buffer): EncryptedData {
  let offset = 0;
  
  // Check magic bytes
  const magic = buffer.subarray(offset, offset + MAGIC_BYTES.length);
  if (!timingSafeEqual(magic, MAGIC_BYTES)) {
    throw new Error('Invalid encrypted file format');
  }
  offset += MAGIC_BYTES.length;
  
  // Version
  const version = buffer.readUInt8(offset);
  offset += 1;
  
  if (version !== 1) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }
  
  // Salt
  const saltLen = buffer.readUInt8(offset);
  offset += 1;
  const salt = buffer.subarray(offset, offset + saltLen);
  offset += saltLen;
  
  // IV
  const ivLen = buffer.readUInt8(offset);
  offset += 1;
  const iv = buffer.subarray(offset, offset + ivLen);
  offset += ivLen;
  
  // Auth tag
  const tagLen = buffer.readUInt8(offset);
  offset += 1;
  const authTag = buffer.subarray(offset, offset + tagLen);
  offset += tagLen;
  
  // Ciphertext
  const ciphertext = buffer.subarray(offset);
  
  return {
    version,
    salt: Buffer.from(salt),
    iv: Buffer.from(iv),
    authTag: Buffer.from(authTag),
    ciphertext: Buffer.from(ciphertext),
  };
}

/**
 * Secure secret store with encryption
 */
export class SecretStore {
  private readonly storePath: string;
  private readonly masterKey: string;
  private secrets: Map<string, string> = new Map();
  private loaded = false;
  private logger: SecureLogger | null = null;
  
  constructor(config: SecretStoreConfig) {
    this.storePath = config.storePath;
    this.masterKey = config.masterKey;
    
    // Validate master key strength
    if (config.masterKey.length < 16) {
      throw new Error('Master key must be at least 16 characters');
    }
  }
  
  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'SecretStore' });
      } catch {
        return {
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          fatal: () => {},
          child: () => this.getLogger(),
          level: 'info',
        };
      }
    }
    return this.logger;
  }
  
  /**
   * Load secrets from encrypted file
   */
  async load(): Promise<void> {
    if (!existsSync(this.storePath)) {
      this.getLogger().info('Secret store not found, starting empty');
      this.loaded = true;
      return;
    }
    
    try {
      const fileData = readFileSync(this.storePath);
      const encrypted = deserializeEncrypted(fileData);
      const decrypted = decrypt(encrypted, this.masterKey);
      
      // Parse JSON
      const data = JSON.parse(decrypted.toString('utf-8')) as Record<string, string>;
      
      // Clear decrypted buffer
      decrypted.fill(0);
      
      // Load into map
      this.secrets = new Map(Object.entries(data));
      this.loaded = true;
      
      this.getLogger().info('Secret store loaded', { 
        secretCount: this.secrets.size,
      });
    } catch (error) {
      this.getLogger().error('Failed to load secret store', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error('Failed to decrypt secret store. Check master key.');
    }
  }
  
  /**
   * Save secrets to encrypted file
   */
  async save(): Promise<void> {
    // Ensure directory exists
    const dir = dirname(this.storePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    
    // Serialize secrets to JSON
    const data = Object.fromEntries(this.secrets);
    const json = JSON.stringify(data);
    
    // Encrypt
    const encrypted = encrypt(json, this.masterKey);
    const serialized = serializeEncrypted(encrypted);
    
    // Write with restricted permissions
    writeFileSync(this.storePath, serialized, { mode: 0o600 });
    
    this.getLogger().info('Secret store saved', {
      secretCount: this.secrets.size,
    });
  }
  
  /**
   * Get a secret by key
   */
  get(key: string): string | undefined {
    if (!this.loaded) {
      throw new Error('Secret store not loaded. Call load() first.');
    }
    
    this.getLogger().debug('Secret accessed', { key });
    return this.secrets.get(key);
  }
  
  /**
   * Set a secret
   */
  async set(key: string, value: string): Promise<void> {
    if (!this.loaded) {
      throw new Error('Secret store not loaded. Call load() first.');
    }
    
    this.secrets.set(key, value);
    await this.save();
    
    this.getLogger().info('Secret stored', { key });
  }
  
  /**
   * Delete a secret
   */
  async delete(key: string): Promise<boolean> {
    if (!this.loaded) {
      throw new Error('Secret store not loaded. Call load() first.');
    }
    
    const deleted = this.secrets.delete(key);
    if (deleted) {
      await this.save();
      this.getLogger().info('Secret deleted', { key });
    }
    return deleted;
  }
  
  /**
   * Check if a secret exists
   */
  has(key: string): boolean {
    if (!this.loaded) {
      throw new Error('Secret store not loaded. Call load() first.');
    }
    return this.secrets.has(key);
  }
  
  /**
   * List all secret keys (not values!)
   */
  keys(): string[] {
    if (!this.loaded) {
      throw new Error('Secret store not loaded. Call load() first.');
    }
    return Array.from(this.secrets.keys());
  }
  
  /**
   * Clear all secrets from memory
   */
  clear(): void {
    this.secrets.clear();
    this.loaded = false;
  }
}

/**
 * Create a secret store with configuration
 */
export function createSecretStore(config: SecretStoreConfig): SecretStore {
  return new SecretStore(config);
}

/**
 * Encrypt a single value (for one-off encryption)
 */
export function encryptValue(value: string, key: string): string {
  const encrypted = encrypt(value, key);
  const serialized = serializeEncrypted(encrypted);
  return serialized.toString('base64');
}

/**
 * Decrypt a single value (for one-off decryption)
 */
export function decryptValue(encryptedBase64: string, key: string): string {
  const buffer = Buffer.from(encryptedBase64, 'base64');
  const encrypted = deserializeEncrypted(buffer);
  const decrypted = decrypt(encrypted, key);
  const value = decrypted.toString('utf-8');
  decrypted.fill(0);
  return value;
}
