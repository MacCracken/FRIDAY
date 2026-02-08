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
 * Encrypt data using AES-256-GCM
 */
export declare function encrypt(plaintext: string | Buffer, masterKey: string): EncryptedData;
/**
 * Decrypt data using AES-256-GCM
 */
export declare function decrypt(encrypted: EncryptedData, masterKey: string): Buffer;
/**
 * Serialize encrypted data to a buffer for storage
 */
export declare function serializeEncrypted(data: EncryptedData): Buffer;
/**
 * Deserialize encrypted data from a buffer
 */
export declare function deserializeEncrypted(buffer: Buffer): EncryptedData;
/**
 * Secure secret store with encryption
 */
export declare class SecretStore {
    private readonly storePath;
    private readonly masterKey;
    private secrets;
    private loaded;
    private logger;
    constructor(config: SecretStoreConfig);
    private getLogger;
    /**
     * Load secrets from encrypted file
     */
    load(): Promise<void>;
    /**
     * Save secrets to encrypted file
     */
    save(): Promise<void>;
    /**
     * Get a secret by key
     */
    get(key: string): string | undefined;
    /**
     * Set a secret
     */
    set(key: string, value: string): Promise<void>;
    /**
     * Delete a secret
     */
    delete(key: string): Promise<boolean>;
    /**
     * Check if a secret exists
     */
    has(key: string): boolean;
    /**
     * List all secret keys (not values!)
     */
    keys(): string[];
    /**
     * Clear all secrets from memory
     */
    clear(): void;
}
/**
 * Create a secret store with configuration
 */
export declare function createSecretStore(config: SecretStoreConfig): SecretStore;
/**
 * Encrypt a single value (for one-off encryption)
 */
export declare function encryptValue(value: string, key: string): string;
/**
 * Decrypt a single value (for one-off decryption)
 */
export declare function decryptValue(encryptedBase64: string, key: string): string;
//# sourceMappingURL=secrets.d.ts.map