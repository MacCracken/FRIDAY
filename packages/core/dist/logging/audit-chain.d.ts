/**
 * Audit Chain for SecureClaw
 *
 * Security considerations:
 * - Append-only log structure prevents tampering
 * - Each entry is signed with HMAC-SHA256
 * - Chain integrity verified by linking entries via hashes
 * - Genesis block establishes chain root
 * - Verification can detect any modification to historical entries
 */
import { type AuditEntry } from '@friday/shared';
export interface AuditChainStorage {
    /** Append an entry to storage */
    append(entry: AuditEntry): Promise<void>;
    /** Get the last entry (for chain continuation) */
    getLast(): Promise<AuditEntry | null>;
    /** Iterate all entries in order */
    iterate(): AsyncIterableIterator<AuditEntry>;
    /** Get entry count */
    count(): Promise<number>;
    /** Get entry by ID */
    getById(id: string): Promise<AuditEntry | null>;
}
export interface AuditChainConfig {
    /** Storage backend */
    storage: AuditChainStorage;
    /** Signing key for HMAC (from environment) */
    signingKey: string;
}
export interface VerificationResult {
    valid: boolean;
    entriesChecked: number;
    brokenAt?: string;
    error?: string;
}
export declare class AuditChain {
    private readonly storage;
    private readonly signingKey;
    private lastHash;
    private initialized;
    private logger;
    constructor(config: AuditChainConfig);
    /**
     * Initialize the chain by loading the last entry
     */
    initialize(): Promise<void>;
    /**
     * Record a new audit entry
     */
    record(params: {
        event: string;
        level: AuditEntry['level'];
        message: string;
        userId?: string;
        taskId?: string;
        correlationId?: string;
        metadata?: Record<string, unknown>;
    }): Promise<AuditEntry>;
    /**
     * Verify the entire audit chain integrity
     */
    verify(): Promise<VerificationResult>;
    /**
     * Get chain statistics
     */
    getStats(): Promise<{
        entriesCount: number;
        chainValid: boolean;
        lastVerification?: number;
    }>;
    /**
     * Create a forensic snapshot of the chain state
     * Used before recovery operations
     */
    createSnapshot(): Promise<{
        timestamp: number;
        entriesCount: number;
        lastHash: string;
        lastEntryId: string | null;
    }>;
}
/**
 * In-memory storage for testing
 */
export declare class InMemoryAuditStorage implements AuditChainStorage {
    private entries;
    append(entry: AuditEntry): Promise<void>;
    getLast(): Promise<AuditEntry | null>;
    iterate(): AsyncIterableIterator<AuditEntry>;
    count(): Promise<number>;
    getById(id: string): Promise<AuditEntry | null>;
}
//# sourceMappingURL=audit-chain.d.ts.map