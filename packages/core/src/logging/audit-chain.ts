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

import { sha256, hmacSha256, secureCompare, uuidv7 } from '../utils/crypto.js';
import { AuditEntrySchema, type AuditEntry } from '@friday/shared';
import { getLogger, type SecureLogger } from './logger.js';

const GENESIS_HASH = '0'.repeat(64); // Genesis block previous hash
const CHAIN_VERSION = '1.0.0';

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

/**
 * Compute the hash of an audit entry (excluding integrity fields)
 */
function computeEntryHash(entry: AuditEntry): string {
  // Create a copy without integrity fields for hashing
  const hashData = {
    id: entry.id,
    correlationId: entry.correlationId,
    event: entry.event,
    level: entry.level,
    message: entry.message,
    userId: entry.userId,
    taskId: entry.taskId,
    metadata: entry.metadata,
    timestamp: entry.timestamp,
  };
  
  // Deterministic JSON serialization
  const serialized = JSON.stringify(hashData, Object.keys(hashData).sort());
  return sha256(serialized);
}

/**
 * Compute the signature for an entry
 */
function computeSignature(entryHash: string, previousHash: string, signingKey: string): string {
  const dataToSign = `${entryHash}:${previousHash}`;
  return hmacSha256(dataToSign, signingKey);
}

export class AuditChain {
  private readonly storage: AuditChainStorage;
  private readonly signingKey: string;
  private lastHash: string = GENESIS_HASH;
  private initialized: boolean = false;
  private logger: SecureLogger | null = null;
  
  constructor(config: AuditChainConfig) {
    this.storage = config.storage;
    this.signingKey = config.signingKey;
    
    // Validate signing key strength
    if (config.signingKey.length < 32) {
      throw new Error('Signing key must be at least 32 characters');
    }
  }
  
  /**
   * Initialize the chain by loading the last entry
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    try {
      this.logger = getLogger().child({ component: 'AuditChain' });
    } catch {
      // Logger not yet initialized, that's ok
    }
    
    const lastEntry = await this.storage.getLast();
    
    if (lastEntry) {
      // Verify the last entry before continuing
      const entryHash = computeEntryHash(lastEntry);
      const expectedSig = computeSignature(
        entryHash,
        lastEntry.integrity.previousEntryHash,
        this.signingKey
      );
      
      if (!secureCompare(lastEntry.integrity.signature, expectedSig)) {
        throw new Error('Audit chain integrity compromised: last entry signature invalid');
      }
      
      this.lastHash = entryHash;
      this.logger?.info('Audit chain initialized', { 
        entriesCount: await this.storage.count(),
        lastEntryId: lastEntry.id,
      });
    } else {
      this.logger?.info('Audit chain initialized (empty chain)');
    }
    
    this.initialized = true;
  }
  
  /**
   * Record a new audit entry
   */
  async record(params: {
    event: string;
    level: AuditEntry['level'];
    message: string;
    userId?: string;
    taskId?: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditEntry> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const entry: AuditEntry = {
      id: uuidv7(),
      correlationId: params.correlationId,
      event: params.event,
      level: params.level,
      message: params.message,
      userId: params.userId,
      taskId: params.taskId,
      metadata: params.metadata,
      timestamp: Date.now(),
      integrity: {
        version: CHAIN_VERSION,
        signature: '', // Will be computed
        previousEntryHash: this.lastHash,
      },
    };
    
    // Compute hash and signature
    const entryHash = computeEntryHash(entry);
    entry.integrity.signature = computeSignature(entryHash, this.lastHash, this.signingKey);
    
    // Validate against schema
    const validation = AuditEntrySchema.safeParse(entry);
    if (!validation.success) {
      throw new Error(`Invalid audit entry: ${validation.error.message}`);
    }
    
    // Persist
    await this.storage.append(entry);
    
    // Update chain state
    this.lastHash = entryHash;
    
    return entry;
  }
  
  /**
   * Verify the entire audit chain integrity
   */
  async verify(): Promise<VerificationResult> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    let entriesChecked = 0;
    let expectedPreviousHash = GENESIS_HASH;
    
    try {
      for await (const entry of this.storage.iterate()) {
        entriesChecked++;
        
        // Check previous hash matches
        if (entry.integrity.previousEntryHash !== expectedPreviousHash) {
          return {
            valid: false,
            entriesChecked,
            brokenAt: entry.id,
            error: 'Chain link broken: previous hash mismatch',
          };
        }
        
        // Compute expected hash and signature
        const entryHash = computeEntryHash(entry);
        const expectedSig = computeSignature(
          entryHash,
          entry.integrity.previousEntryHash,
          this.signingKey
        );
        
        // Verify signature
        if (!secureCompare(entry.integrity.signature, expectedSig)) {
          return {
            valid: false,
            entriesChecked,
            brokenAt: entry.id,
            error: 'Signature verification failed',
          };
        }
        
        // Move to next
        expectedPreviousHash = entryHash;
      }
      
      return {
        valid: true,
        entriesChecked,
      };
    } catch (error) {
      return {
        valid: false,
        entriesChecked,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
  
  /**
   * Get chain statistics
   */
  async getStats(): Promise<{
    entriesCount: number;
    chainValid: boolean;
    lastVerification?: number;
  }> {
    const count = await this.storage.count();
    const verification = await this.verify();
    
    return {
      entriesCount: count,
      chainValid: verification.valid,
      lastVerification: Date.now(),
    };
  }
  
  /**
   * Create a forensic snapshot of the chain state
   * Used before recovery operations
   */
  async createSnapshot(): Promise<{
    timestamp: number;
    entriesCount: number;
    lastHash: string;
    lastEntryId: string | null;
  }> {
    const lastEntry = await this.storage.getLast();
    
    return {
      timestamp: Date.now(),
      entriesCount: await this.storage.count(),
      lastHash: this.lastHash,
      lastEntryId: lastEntry?.id ?? null,
    };
  }
}

/**
 * In-memory storage for testing
 */
export class InMemoryAuditStorage implements AuditChainStorage {
  private entries: AuditEntry[] = [];
  
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  
  async getLast(): Promise<AuditEntry | null> {
    return this.entries[this.entries.length - 1] ?? null;
  }
  
  async *iterate(): AsyncIterableIterator<AuditEntry> {
    for (const entry of this.entries) {
      yield entry;
    }
  }
  
  async count(): Promise<number> {
    return this.entries.length;
  }
  
  async getById(id: string): Promise<AuditEntry | null> {
    return this.entries.find(e => e.id === id) ?? null;
  }
}
