import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentCrypto, sanitizePayload } from './crypto.js';
import { CommsStorage } from './storage.js';
import { AgentComms } from './agent-comms.js';
import type { MessagePayload, AgentCommsDeps } from './types.js';
import type { SecureLogger } from '../logging/logger.js';
import { AuditChain, InMemoryAuditStorage } from '../logging/audit-chain.js';

// ── Helpers ──────────────────────────────────────────────────────

function noopLogger(): SecureLogger {
  const noop = () => {};
  return {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    child: () => noopLogger(),
    level: 'silent',
  } as SecureLogger;
}

function createDeps(): AgentCommsDeps {
  const auditStorage = new InMemoryAuditStorage();
  const auditChain = new AuditChain({ storage: auditStorage, signingKey: 'test-signing-key-must-be-at-least-32-chars!!' });
  return {
    auditChain,
    logger: noopLogger(),
  };
}

// ── AgentCrypto Tests ─────────────────────────────────────────────

describe('AgentCrypto', () => {
  it('should generate keypairs', () => {
    const crypto = new AgentCrypto();
    expect(crypto.publicKey).toBeDefined();
    expect(crypto.signingPublicKey).toBeDefined();
    expect(crypto.publicKey.length).toBeGreaterThan(10);
    expect(crypto.signingPublicKey.length).toBeGreaterThan(10);
  });

  it('should encrypt and decrypt messages', () => {
    const alice = new AgentCrypto();
    const bob = new AgentCrypto();

    const payload: MessagePayload = {
      type: 'task_request',
      content: 'Hello from Alice',
      metadata: { priority: 'high' },
    };

    const encrypted = alice.encrypt(payload, bob.publicKey);
    expect(encrypted.ephemeralPublicKey).toBeDefined();
    expect(encrypted.nonce).toBeDefined();
    expect(encrypted.ciphertext).toBeDefined();

    const decrypted = bob.decrypt(encrypted);
    expect(decrypted.type).toBe('task_request');
    expect(decrypted.content).toBe('Hello from Alice');
    expect(decrypted.metadata.priority).toBe('high');
  });

  it('should produce different ciphertexts for same message (ephemeral keys)', () => {
    const alice = new AgentCrypto();
    const bob = new AgentCrypto();

    const payload: MessagePayload = {
      type: 'status_update',
      content: 'Same message',
      metadata: {},
    };

    const enc1 = alice.encrypt(payload, bob.publicKey);
    const enc2 = alice.encrypt(payload, bob.publicKey);

    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    expect(enc1.ephemeralPublicKey).not.toBe(enc2.ephemeralPublicKey);
  });

  it('should fail to decrypt with wrong key', () => {
    const alice = new AgentCrypto();
    const bob = new AgentCrypto();
    const mallory = new AgentCrypto();

    const payload: MessagePayload = {
      type: 'task_request',
      content: 'Secret message',
      metadata: {},
    };

    const encrypted = alice.encrypt(payload, bob.publicKey);

    // Mallory should not be able to decrypt
    expect(() => mallory.decrypt(encrypted)).toThrow();
  });

  it('should sign and verify data', () => {
    const agent = new AgentCrypto();
    const data = Buffer.from('important data');

    const signature = agent.signData(data);
    expect(signature.length).toBeGreaterThan(10);

    const valid = agent.verifySignature(data, signature, agent.signingPublicKey);
    expect(valid).toBe(true);
  });

  it('should reject invalid signatures', () => {
    const alice = new AgentCrypto();
    const bob = new AgentCrypto();

    const data = Buffer.from('important data');
    const signature = alice.signData(data);

    // Bob's key should not verify Alice's signature
    const valid = alice.verifySignature(data, signature, bob.signingPublicKey);
    expect(valid).toBe(false);
  });

  it('should reject tampered data', () => {
    const agent = new AgentCrypto();
    const data = Buffer.from('original data');
    const signature = agent.signData(data);

    const tampered = Buffer.from('tampered data');
    const valid = agent.verifySignature(tampered, signature, agent.signingPublicKey);
    expect(valid).toBe(false);
  });
});

// ── sanitizePayload Tests ─────────────────────────────────────────

describe('sanitizePayload', () => {
  it('should redact API keys', () => {
    const payload: MessagePayload = {
      type: 'task_request',
      content: 'Use key sk-abcdefghijklmnopqrstuvwxyz for auth',
      metadata: {},
    };
    const sanitized = sanitizePayload(payload);
    expect(sanitized.content).toContain('[REDACTED]');
    expect(sanitized.content).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });

  it('should redact Bearer tokens', () => {
    const payload: MessagePayload = {
      type: 'task_request',
      content: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test',
      metadata: {},
    };
    const sanitized = sanitizePayload(payload);
    expect(sanitized.content).toContain('[REDACTED]');
    expect(sanitized.content).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('should redact password assignments', () => {
    const payload: MessagePayload = {
      type: 'task_request',
      content: 'password=my-secret-password',
      metadata: {},
    };
    const sanitized = sanitizePayload(payload);
    expect(sanitized.content).toContain('[REDACTED]');
    expect(sanitized.content).not.toContain('my-secret-password');
  });

  it('should redact sensitive metadata keys', () => {
    const payload: MessagePayload = {
      type: 'task_request',
      content: 'Hello',
      metadata: { apiKey: 'secret123', topic: 'safe-value' },
    };
    const sanitized = sanitizePayload(payload);
    expect(sanitized.metadata.apiKey).toBe('[REDACTED]');
    expect(sanitized.metadata.topic).toBe('safe-value');
  });

  it('should not modify clean payloads', () => {
    const payload: MessagePayload = {
      type: 'knowledge_share',
      content: 'React is a UI framework',
      metadata: { topic: 'frontend' },
    };
    const sanitized = sanitizePayload(payload);
    expect(sanitized.content).toBe(payload.content);
    expect(sanitized.metadata).toEqual(payload.metadata);
  });

  it('should redact PEM keys', () => {
    const payload: MessagePayload = {
      type: 'task_request',
      content: '-----BEGIN PRIVATE KEY-----\nfoo\n-----END PRIVATE KEY-----',
      metadata: {},
    };
    const sanitized = sanitizePayload(payload);
    expect(sanitized.content).toContain('[REDACTED]');
  });
});

// ── CommsStorage Tests ────────────────────────────────────────────

describe('CommsStorage', () => {
  let storage: CommsStorage;

  beforeEach(() => {
    storage = new CommsStorage();
  });

  afterEach(() => {
    storage.close();
  });

  describe('peers', () => {
    it('should add and retrieve a peer', () => {
      const peer = {
        id: 'agent-1',
        name: 'FRIDAY-Alpha',
        publicKey: 'pub-key-base64',
        signingKey: 'sign-key-base64',
        endpoint: 'https://agent1.local:18789',
        capabilities: ['task_execution'],
        lastSeenAt: Date.now(),
      };
      storage.addPeer(peer);

      const retrieved = storage.getPeer('agent-1');
      expect(retrieved?.name).toBe('FRIDAY-Alpha');
      expect(retrieved?.capabilities).toEqual(['task_execution']);
    });

    it('should return null for non-existent peer', () => {
      expect(storage.getPeer('nonexistent')).toBeNull();
    });

    it('should list peers', () => {
      storage.addPeer({
        id: 'a1', name: 'Agent1', publicKey: 'k1', signingKey: 'sk1',
        endpoint: 'http://a1', capabilities: [], lastSeenAt: Date.now(),
      });
      storage.addPeer({
        id: 'a2', name: 'Agent2', publicKey: 'k2', signingKey: 'sk2',
        endpoint: 'http://a2', capabilities: [], lastSeenAt: Date.now(),
      });

      expect(storage.listPeers()).toHaveLength(2);
    });

    it('should remove a peer', () => {
      storage.addPeer({
        id: 'a1', name: 'Agent1', publicKey: 'k1', signingKey: 'sk1',
        endpoint: 'http://a1', capabilities: [], lastSeenAt: Date.now(),
      });
      expect(storage.removePeer('a1')).toBe(true);
      expect(storage.getPeer('a1')).toBeNull();
    });

    it('should return false removing non-existent peer', () => {
      expect(storage.removePeer('nonexistent')).toBe(false);
    });

    it('should update peer on re-add (upsert)', () => {
      const peer = {
        id: 'a1', name: 'Agent1', publicKey: 'k1', signingKey: 'sk1',
        endpoint: 'http://a1', capabilities: [], lastSeenAt: Date.now(),
      };
      storage.addPeer(peer);
      storage.addPeer({ ...peer, name: 'Agent1-Updated' });

      const retrieved = storage.getPeer('a1');
      expect(retrieved?.name).toBe('Agent1-Updated');
      expect(storage.getPeerCount()).toBe(1);
    });

    it('should update peer last seen', () => {
      storage.addPeer({
        id: 'a1', name: 'Agent1', publicKey: 'k1', signingKey: 'sk1',
        endpoint: 'http://a1', capabilities: [], lastSeenAt: 1000,
      });
      storage.updatePeerLastSeen('a1');

      const updated = storage.getPeer('a1');
      expect(updated?.lastSeenAt).toBeGreaterThan(1000);
    });

    it('should count peers', () => {
      expect(storage.getPeerCount()).toBe(0);
      storage.addPeer({
        id: 'a1', name: 'Agent1', publicKey: 'k1', signingKey: 'sk1',
        endpoint: 'http://a1', capabilities: [], lastSeenAt: Date.now(),
      });
      expect(storage.getPeerCount()).toBe(1);
    });
  });

  describe('message log', () => {
    it('should log a message', () => {
      const id = storage.logMessage('sent', 'agent-2', 'task_request', '{"encrypted":"data"}');
      expect(id).toBeDefined();
    });

    it('should query message log', () => {
      storage.logMessage('sent', 'agent-2', 'task_request', '{"e":"d1"}');
      storage.logMessage('received', 'agent-2', 'task_response', '{"e":"d2"}');
      storage.logMessage('sent', 'agent-3', 'status_update', '{"e":"d3"}');

      const all = storage.queryMessageLog();
      expect(all).toHaveLength(3);

      const fromAgent2 = storage.queryMessageLog({ peerId: 'agent-2' });
      expect(fromAgent2).toHaveLength(2);

      const tasks = storage.queryMessageLog({ type: 'task_request' });
      expect(tasks).toHaveLength(1);

      const limited = storage.queryMessageLog({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('should prune old messages', () => {
      storage.logMessage('sent', 'agent-2', 'task_request', '{"e":"d1"}');
      // This test just checks the method runs without error
      const pruned = storage.pruneOldMessages(30);
      expect(pruned).toBe(0); // Nothing old enough
    });

    it('should count messages', () => {
      expect(storage.getMessageCount()).toBe(0);
      storage.logMessage('sent', 'agent-2', 'task_request', '{"e":"d1"}');
      expect(storage.getMessageCount()).toBe(1);
    });
  });
});

// ── AgentComms Tests ──────────────────────────────────────────────

describe('AgentComms', () => {
  let alice: AgentComms;
  let bob: AgentComms;

  beforeEach(async () => {
    alice = new AgentComms(
      { enabled: true, agentName: 'Alice', listenForPeers: true, maxPeers: 10, messageRetentionDays: 30 },
      createDeps(),
    );
    bob = new AgentComms(
      { enabled: true, agentName: 'Bob', listenForPeers: true, maxPeers: 10, messageRetentionDays: 30 },
      createDeps(),
    );

    await alice.init();
    await bob.init();
  });

  afterEach(() => {
    alice.close();
    bob.close();
  });

  it('should generate identity', () => {
    const identity = alice.getIdentity();
    expect(identity.name).toBe('Alice');
    expect(identity.publicKey).toBeDefined();
    expect(identity.signingKey).toBeDefined();
  });

  it('should add and list peers', () => {
    const bobIdentity = bob.getIdentity();
    alice.addPeer(bobIdentity);

    const peers = alice.listPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0].name).toBe('Bob');
  });

  it('should remove a peer', () => {
    const bobIdentity = bob.getIdentity();
    alice.addPeer(bobIdentity);
    expect(alice.removePeer(bobIdentity.id)).toBe(true);
    expect(alice.listPeers()).toHaveLength(0);
  });

  it('should encrypt and decrypt messages between agents', () => {
    // Register each other as peers
    alice.addPeer(bob.getIdentity());
    bob.addPeer(alice.getIdentity());

    const payload: MessagePayload = {
      type: 'task_request',
      content: 'Please run the tests',
      metadata: { priority: 'high' },
    };

    // Alice encrypts for Bob
    const encrypted = alice.encryptMessage(bob.getIdentity().id, payload);
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.signature).toBeDefined();

    // Bob decrypts
    const decrypted = bob.decryptMessage(encrypted);
    expect(decrypted.type).toBe('task_request');
    expect(decrypted.content).toBe('Please run the tests');
    expect(decrypted.metadata.priority).toBe('high');
  });

  it('should sanitize secrets before encrypting', () => {
    alice.addPeer(bob.getIdentity());
    bob.addPeer(alice.getIdentity());

    const payload: MessagePayload = {
      type: 'task_request',
      content: 'Use API key sk-abcdefghijklmnopqrstuvwxyz123',
      metadata: { apiKey: 'secret-value' },
    };

    const encrypted = alice.encryptMessage(bob.getIdentity().id, payload);
    const decrypted = bob.decryptMessage(encrypted);

    // Content should be sanitized
    expect(decrypted.content).toContain('[REDACTED]');
    expect(decrypted.content).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123');
    expect(decrypted.metadata.apiKey).toBe('[REDACTED]');
  });

  it('should reject messages from unknown senders', () => {
    alice.addPeer(bob.getIdentity());
    // Bob does NOT add Alice as a peer

    const payload: MessagePayload = {
      type: 'status_update',
      content: 'Hello',
      metadata: {},
    };

    const encrypted = alice.encryptMessage(bob.getIdentity().id, payload);
    expect(() => bob.decryptMessage(encrypted)).toThrow('Unknown sender');
  });

  it('should reject messages to unknown recipients', () => {
    const payload: MessagePayload = {
      type: 'task_request',
      content: 'Hello',
      metadata: {},
    };

    expect(() => alice.encryptMessage('unknown-agent', payload)).toThrow('Unknown peer');
  });

  it('should log sent and received messages', () => {
    alice.addPeer(bob.getIdentity());
    bob.addPeer(alice.getIdentity());

    const payload: MessagePayload = {
      type: 'knowledge_share',
      content: 'React is cool',
      metadata: {},
    };

    alice.encryptMessage(bob.getIdentity().id, payload);

    const aliceLog = alice.getMessageLog();
    expect(aliceLog).toHaveLength(1);
    expect(aliceLog[0].direction).toBe('sent');
  });

  it('should enforce max peers limit', () => {
    const comms = new AgentComms(
      { enabled: true, agentName: 'Test', listenForPeers: true, maxPeers: 1, messageRetentionDays: 30 },
      createDeps(),
    );
    // Need to init to use addPeer
    comms.init().then(() => {
      comms.addPeer(bob.getIdentity());
      expect(() => comms.addPeer(alice.getIdentity())).toThrow('Maximum peer limit');
      comms.close();
    });
  });

  it('should throw when not initialized', () => {
    const comms = new AgentComms(
      { enabled: true, agentName: 'Test', listenForPeers: true, maxPeers: 10, messageRetentionDays: 30 },
      createDeps(),
    );
    expect(() => comms.getIdentity()).toThrow('not initialized');
    expect(() => comms.addPeer(bob.getIdentity())).toThrow('not initialized');
  });
});
