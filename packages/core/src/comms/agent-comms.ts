/**
 * AgentComms — E2E encrypted communication between FRIDAY agents.
 *
 * Manages peer discovery, message encryption/decryption, and local logging.
 */

import { AgentCrypto, sanitizePayload } from './crypto.js';
import { CommsStorage } from './storage.js';
import type {
  AgentIdentity,
  EncryptedMessage,
  MessagePayload,
  MessageLogQuery,
  AgentCommsDeps,
  CommsConfig,
} from './types.js';
import { uuidv7 } from '../utils/crypto.js';

export class AgentComms {
  private crypto: AgentCrypto | null = null;
  private storage: CommsStorage | null = null;
  private readonly config: CommsConfig;
  private readonly deps: AgentCommsDeps;
  private agentId: string;
  private agentName: string;

  constructor(config: CommsConfig, deps: AgentCommsDeps) {
    this.config = config;
    this.deps = deps;
    this.agentId = uuidv7();
    this.agentName = config.agentName || 'FRIDAY';
  }

  async init(opts: { keyStorePath?: string; dbPath?: string } = {}): Promise<void> {
    this.crypto = new AgentCrypto(opts.keyStorePath);
    this.storage = new CommsStorage({ dbPath: opts.dbPath });
    this.deps.logger.debug('Agent comms initialized', {
      agentId: this.agentId,
      publicKey: this.crypto.publicKey.slice(0, 20) + '...',
    });
  }

  getIdentity(): AgentIdentity {
    if (!this.crypto) throw new Error('Agent comms not initialized');
    return {
      id: this.agentId,
      name: this.agentName,
      publicKey: this.crypto.publicKey,
      signingKey: this.crypto.signingPublicKey,
      endpoint: '',
      capabilities: [],
      lastSeenAt: Date.now(),
    };
  }

  // ── Peer Management ────────────────────────────────────────

  addPeer(identity: AgentIdentity): void {
    if (!this.storage) throw new Error('Agent comms not initialized');
    if (this.storage.getPeerCount() >= this.config.maxPeers) {
      throw new Error(`Maximum peer limit reached (${this.config.maxPeers})`);
    }
    this.storage.addPeer(identity);
    this.deps.logger.debug('Peer added', { peerId: identity.id, name: identity.name });
  }

  getPeer(id: string): AgentIdentity | null {
    if (!this.storage) throw new Error('Agent comms not initialized');
    return this.storage.getPeer(id);
  }

  listPeers(): AgentIdentity[] {
    if (!this.storage) throw new Error('Agent comms not initialized');
    return this.storage.listPeers();
  }

  removePeer(id: string): boolean {
    if (!this.storage) throw new Error('Agent comms not initialized');
    return this.storage.removePeer(id);
  }

  // ── Message Operations ─────────────────────────────────────

  encryptMessage(toAgentId: string, payload: MessagePayload): EncryptedMessage {
    if (!this.crypto || !this.storage) throw new Error('Agent comms not initialized');

    const peer = this.storage.getPeer(toAgentId);
    if (!peer) throw new Error(`Unknown peer: ${toAgentId}`);

    // 1. Sanitize payload
    const sanitized = sanitizePayload(payload);

    // 2. Encrypt
    const encrypted = this.crypto.encrypt(sanitized, peer.publicKey);

    // 3. Sign
    const dataToSign = Buffer.from(encrypted.ciphertext + encrypted.nonce + this.agentId);
    const signature = this.crypto.signData(dataToSign);

    // 4. Log locally
    this.storage.logMessage('sent', toAgentId, payload.type, JSON.stringify(encrypted));

    const message: EncryptedMessage = {
      id: uuidv7(),
      fromAgentId: this.agentId,
      toAgentId,
      ephemeralPublicKey: encrypted.ephemeralPublicKey,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      signature,
      timestamp: Date.now(),
    };

    this.deps.logger.debug('Message encrypted', {
      toAgent: toAgentId,
      type: payload.type,
    });

    return message;
  }

  decryptMessage(encrypted: EncryptedMessage): MessagePayload {
    if (!this.crypto || !this.storage) throw new Error('Agent comms not initialized');

    // 1. Verify sender is known
    const sender = this.storage.getPeer(encrypted.fromAgentId);
    if (!sender) throw new Error(`Unknown sender: ${encrypted.fromAgentId}`);

    // 2. Verify signature
    const dataToVerify = Buffer.from(encrypted.ciphertext + encrypted.nonce + encrypted.fromAgentId);
    const valid = this.crypto.verifySignature(dataToVerify, encrypted.signature, sender.signingKey);
    if (!valid) {
      throw new Error('Invalid message signature');
    }

    // 3. Decrypt
    const payload = this.crypto.decrypt({
      ephemeralPublicKey: encrypted.ephemeralPublicKey,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    });

    // 4. Log locally
    this.storage.logMessage('received', encrypted.fromAgentId, payload.type, JSON.stringify({
      ephemeralPublicKey: encrypted.ephemeralPublicKey,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    }));

    // 5. Update peer last seen
    this.storage.updatePeerLastSeen(encrypted.fromAgentId);

    this.deps.logger.debug('Message decrypted', {
      fromAgent: encrypted.fromAgentId,
      type: payload.type,
    });

    return payload;
  }

  // ── Message Log ────────────────────────────────────────────

  getMessageLog(query?: MessageLogQuery): Array<{
    id: string;
    direction: string;
    peerAgentId: string;
    messageType: string;
    timestamp: number;
  }> {
    if (!this.storage) throw new Error('Agent comms not initialized');
    const rows = this.storage.queryMessageLog(query);
    return rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      peerAgentId: r.peer_agent_id,
      messageType: r.message_type,
      timestamp: r.timestamp,
    }));
  }

  // ── Maintenance ────────────────────────────────────────────

  runMaintenance(): { pruned: number } {
    if (!this.storage) return { pruned: 0 };
    const pruned = this.storage.pruneOldMessages(this.config.messageRetentionDays);
    return { pruned };
  }

  // ── Cleanup ────────────────────────────────────────────────

  close(): void {
    this.storage?.close();
  }
}
