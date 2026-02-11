/**
 * Comms Module — Internal Types for agent-to-agent communication.
 */

export type { CommsConfig } from '@friday/shared';
import type { MessageType } from '@friday/shared';
export type { MessageType } from '@friday/shared';

export interface AgentIdentity {
  id: string;
  name: string;
  publicKey: string;
  signingKey: string;
  endpoint: string;
  capabilities: string[];
  lastSeenAt: number;
}

export interface EncryptedMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
  signature: string;
  timestamp: number;
}

export interface MessagePayload {
  type: MessageType;
  content: string;
  metadata: Record<string, string>;
}

export interface DecryptedLogEntry {
  id: string;
  direction: 'sent' | 'received';
  peerAgentId: string;
  messageType: MessageType;
  payload: MessagePayload;
  timestamp: number;
}

export interface PeerQuery {
  limit?: number;
}

export interface MessageLogQuery {
  peerId?: string;
  type?: MessageType;
  limit?: number;
}

import type { AuditChain } from '../logging/audit-chain.js';
import type { SecureLogger } from '../logging/logger.js';

export interface AgentCommsDeps {
  logger: SecureLogger;
  auditChain: AuditChain;
}
