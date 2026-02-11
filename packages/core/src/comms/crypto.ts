/**
 * Agent Crypto — E2E encryption for agent-to-agent communication.
 *
 * Uses X25519 for key exchange and Ed25519 for signing.
 * Per-message encryption with ephemeral ECDH → HKDF → AES-256-GCM.
 */

import {
  generateKeyPairSync,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  diffieHellman,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  hkdfSync,
  KeyObject,
} from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MessagePayload } from './types.js';

export interface EncryptedPayload {
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
}

export class AgentCrypto {
  private x25519PrivateKey: KeyObject;
  private ed25519PrivateKey: KeyObject;
  public readonly publicKey: string;
  public readonly signingPublicKey: string;

  constructor(keyStorePath?: string) {
    if (keyStorePath && existsSync(keyStorePath)) {
      const stored = JSON.parse(readFileSync(keyStorePath, 'utf8')) as {
        x25519Private: string;
        ed25519Private: string;
      };
      this.x25519PrivateKey = createPrivateKey({
        key: Buffer.from(stored.x25519Private, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
      this.ed25519PrivateKey = createPrivateKey({
        key: Buffer.from(stored.ed25519Private, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
    } else {
      const x25519Pair = generateKeyPairSync('x25519');
      const ed25519Pair = generateKeyPairSync('ed25519');
      this.x25519PrivateKey = x25519Pair.privateKey;
      this.ed25519PrivateKey = ed25519Pair.privateKey;

      if (keyStorePath) {
        mkdirSync(dirname(keyStorePath), { recursive: true });
        const toStore = {
          x25519Private: this.x25519PrivateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
          ed25519Private: this.ed25519PrivateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
        };
        writeFileSync(keyStorePath, JSON.stringify(toStore), { mode: 0o600 });
      }
    }

    // Extract public keys
    const x25519Pub = createPublicKey(this.x25519PrivateKey);
    const ed25519Pub = createPublicKey(this.ed25519PrivateKey);
    this.publicKey = x25519Pub.export({ format: 'der', type: 'spki' }).toString('base64');
    this.signingPublicKey = ed25519Pub.export({ format: 'der', type: 'spki' }).toString('base64');
  }

  encrypt(payload: MessagePayload, recipientPublicKey: string): EncryptedPayload {
    // 1. Generate ephemeral X25519 keypair
    const ephemeral = generateKeyPairSync('x25519');

    // 2. Derive shared secret via ECDH
    const recipientKey = createPublicKey({
      key: Buffer.from(recipientPublicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const sharedSecret = diffieHellman({
      privateKey: ephemeral.privateKey,
      publicKey: recipientKey,
    });

    // 3. Derive encryption key via HKDF
    const nonce = randomBytes(12);
    const derivedKey = Buffer.from(
      hkdfSync('sha256', sharedSecret, nonce, 'friday-agent-comms', 32),
    );

    // 4. Encrypt with AES-256-GCM
    const plaintext = JSON.stringify(payload);
    const cipher = createCipheriv('aes-256-gcm', derivedKey, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([encrypted, authTag]);

    // 5. Return ephemeral public key + nonce + ciphertext
    const ephemeralPub = ephemeral.publicKey.export({ format: 'der', type: 'spki' });

    return {
      ephemeralPublicKey: ephemeralPub.toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  decrypt(encrypted: EncryptedPayload): MessagePayload {
    // 1. Derive shared secret via ECDH
    const ephemeralPub = createPublicKey({
      key: Buffer.from(encrypted.ephemeralPublicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const sharedSecret = diffieHellman({
      privateKey: this.x25519PrivateKey,
      publicKey: ephemeralPub,
    });

    // 2. Derive decryption key via HKDF
    const nonce = Buffer.from(encrypted.nonce, 'base64');
    const derivedKey = Buffer.from(
      hkdfSync('sha256', sharedSecret, nonce, 'friday-agent-comms', 32),
    );

    // 3. Decrypt with AES-256-GCM
    const ciphertextBuf = Buffer.from(encrypted.ciphertext, 'base64');
    const authTag = ciphertextBuf.subarray(ciphertextBuf.length - 16);
    const encryptedData = ciphertextBuf.subarray(0, ciphertextBuf.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', derivedKey, nonce);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

    return JSON.parse(decrypted.toString('utf8')) as MessagePayload;
  }

  signData(data: Buffer): string {
    return sign(null, data, this.ed25519PrivateKey).toString('base64');
  }

  verifySignature(data: Buffer, signature: string, signingPublicKey: string): boolean {
    const pubKey = createPublicKey({
      key: Buffer.from(signingPublicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return verify(null, data, pubKey, Buffer.from(signature, 'base64'));
  }
}

/**
 * Strip detected secrets from message payloads before sending.
 */
export function sanitizePayload(payload: MessagePayload): MessagePayload {
  const sensitivePatterns = [
    /sk-[a-zA-Z0-9]{20,}/g,
    /Bearer\s+[a-zA-Z0-9._-]+/g,
    /-----BEGIN\s+\w+\s+KEY-----/g,
    /password\s*[:=]\s*\S+/gi,
    /secret\s*[:=]\s*\S+/gi,
    /token\s*[:=]\s*\S+/gi,
  ];

  let sanitized = payload.content;
  for (const pattern of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  const sanitizedMeta = { ...payload.metadata };
  for (const [key, value] of Object.entries(sanitizedMeta)) {
    if (/key|token|secret|password|credential/i.test(key)) {
      sanitizedMeta[key] = '[REDACTED]';
    }
  }

  return { ...payload, content: sanitized, metadata: sanitizedMeta };
}
