/**
 * Agent Crypto — E2E encryption for agent-to-agent communication.
 *
 * X25519 for key exchange, Ed25519 for signing, HKDF for key derivation,
 * AES-256-GCM for symmetric encryption — all via node:crypto. The native
 * sy-crypto NAPI bridge was retired in the Rust-native era (Rust sy-core has
 * its own crypto module); this TS class remains for packages that still import
 * it during the migration.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  sign,
  verify,
  hkdfSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import type { MessagePayload } from './types.js';

export interface EncryptedPayload {
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
}

// Raw X25519 private key (32 bytes) → PKCS#8 DER KeyObject.
// PKCS#8 for X25519 is a fixed 16-byte prefix + the 32-byte key.
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
// Same shape for Ed25519, different OID.
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function rawToX25519PrivateKey(raw: Buffer): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
}

function rawToEd25519PrivateKey(raw: Buffer): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
}

function extractRawPublicFromSpki(spki: Buffer): Buffer {
  // SPKI for X25519/Ed25519 is a 12-byte prefix + 32-byte public key.
  return spki.subarray(spki.length - 32);
}

function rawToX25519PublicKey(raw: Buffer): KeyObject {
  // X25519 SPKI prefix (12 bytes): 302a300506032b656e032100
  const spkiPrefix = Buffer.from('302a300506032b656e032100', 'hex');
  return createPublicKey({
    key: Buffer.concat([spkiPrefix, raw]),
    format: 'der',
    type: 'spki',
  });
}

function rawToEd25519PublicKey(raw: Buffer): KeyObject {
  // Ed25519 SPKI prefix (12 bytes): 302a300506032b6570032100
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({
    key: Buffer.concat([spkiPrefix, raw]),
    format: 'der',
    type: 'spki',
  });
}

function derivePublicRaw(privateKey: KeyObject): Buffer {
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return extractRawPublicFromSpki(Buffer.from(spki));
}

export class AgentCrypto {
  private x25519PrivateKey: Buffer;
  private ed25519PrivateKey: Buffer;
  public readonly publicKey: string;
  public readonly signingPublicKey: string;

  constructor(keyStorePath?: string) {
    if (keyStorePath && existsSync(keyStorePath)) {
      let stored: { x25519Private: string; ed25519Private: string };
      try {
        stored = JSON.parse(readFileSync(keyStorePath, 'utf8')) as {
          x25519Private: string;
          ed25519Private: string;
        };
      } catch (err) {
        throw new Error(
          `Failed to parse key store at ${keyStorePath}: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err }
        );
      }
      this.x25519PrivateKey = Buffer.from(stored.x25519Private, 'base64');
      this.ed25519PrivateKey = Buffer.from(stored.ed25519Private, 'base64');
      this.publicKey = derivePublicRaw(rawToX25519PrivateKey(this.x25519PrivateKey)).toString(
        'base64'
      );
      this.signingPublicKey = derivePublicRaw(
        rawToEd25519PrivateKey(this.ed25519PrivateKey)
      ).toString('base64');
      return;
    }

    const x25519 = generateKeyPairSync('x25519');
    const ed25519 = generateKeyPairSync('ed25519');
    this.x25519PrivateKey = extractRawPublicFromSpki(
      Buffer.from(x25519.privateKey.export({ format: 'der', type: 'pkcs8' }))
    );
    this.ed25519PrivateKey = extractRawPublicFromSpki(
      Buffer.from(ed25519.privateKey.export({ format: 'der', type: 'pkcs8' }))
    );
    this.publicKey = derivePublicRaw(x25519.privateKey).toString('base64');
    this.signingPublicKey = derivePublicRaw(ed25519.privateKey).toString('base64');

    if (keyStorePath) {
      mkdirSync(dirname(keyStorePath), { recursive: true });
      writeFileSync(
        keyStorePath,
        JSON.stringify({
          x25519Private: this.x25519PrivateKey.toString('base64'),
          ed25519Private: this.ed25519PrivateKey.toString('base64'),
        }),
        { mode: 0o600 }
      );
    }
  }

  encrypt(payload: MessagePayload, recipientPublicKey: string): EncryptedPayload {
    const ephemeral = generateKeyPairSync('x25519');
    const ephemeralRawPublic = derivePublicRaw(ephemeral.privateKey);
    const recipientKey = rawToX25519PublicKey(Buffer.from(recipientPublicKey, 'base64'));

    const sharedSecret = diffieHellman({
      privateKey: ephemeral.privateKey,
      publicKey: recipientKey,
    });

    const nonce = randomBytes(12);
    const derivedKey = Buffer.from(
      hkdfSync('sha256', sharedSecret, nonce, Buffer.from('secureyeoman-agent-comms'), 32)
    );

    const cipher = createCipheriv('aes-256-gcm', derivedKey, nonce);
    const plaintext = Buffer.from(JSON.stringify(payload));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Ciphertext format: encrypted || authTag (16 bytes)
    const ciphertext = Buffer.concat([encrypted, authTag]);

    return {
      ephemeralPublicKey: ephemeralRawPublic.toString('base64'),
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  decrypt(encrypted: EncryptedPayload): MessagePayload {
    const ephemeralPublic = rawToX25519PublicKey(
      Buffer.from(encrypted.ephemeralPublicKey, 'base64')
    );
    const privateKey = rawToX25519PrivateKey(this.x25519PrivateKey);

    const sharedSecret = diffieHellman({
      privateKey,
      publicKey: ephemeralPublic,
    });

    const nonce = Buffer.from(encrypted.nonce, 'base64');
    const derivedKey = Buffer.from(
      hkdfSync('sha256', sharedSecret, nonce, Buffer.from('secureyeoman-agent-comms'), 32)
    );

    const ciphertextBuf = Buffer.from(encrypted.ciphertext, 'base64');
    const authTag = ciphertextBuf.subarray(ciphertextBuf.length - 16);
    const ciphertext = ciphertextBuf.subarray(0, ciphertextBuf.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', derivedKey, nonce);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return JSON.parse(decrypted.toString('utf8')) as MessagePayload;
  }

  signData(data: Buffer): string {
    const privateKey = rawToEd25519PrivateKey(this.ed25519PrivateKey);
    const signature = sign(null, data, privateKey);
    return signature.toString('base64');
  }

  verifySignature(data: Buffer, signature: string, signingPublicKey: string): boolean {
    try {
      const publicKey = rawToEd25519PublicKey(Buffer.from(signingPublicKey, 'base64'));
      const sigBuf = Buffer.from(signature, 'base64');
      return verify(null, data, publicKey, sigBuf);
    } catch {
      return false;
    }
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
  for (const [key, _value] of Object.entries(sanitizedMeta)) {
    if (/key|token|secret|password|credential/i.test(key)) {
      sanitizedMeta[key] = '[REDACTED]';
    }
  }

  return { ...payload, content: sanitized, metadata: sanitizedMeta };
}
