/**
 * Comms Module — E2E encrypted agent-to-agent communication
 */

export { AgentCrypto, sanitizePayload } from './crypto.js';
export { AgentComms } from './agent-comms.js';
export { CommsStorage } from './storage.js';

export type {
  AgentIdentity,
  EncryptedMessage,
  MessagePayload,
  MessageType,
  DecryptedLogEntry,
  MessageLogQuery,
  AgentCommsDeps,
} from './types.js';
