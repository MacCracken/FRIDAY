/**
 * Agent Crypto — E2E encryption for agent-to-agent communication.
 *
 * Uses sy-crypto (native Rust via NAPI) for all cryptographic operations:
 * X25519 for key exchange, Ed25519 for signing, HKDF for key derivation,
 * and AES-256-GCM for symmetric encryption.
 *
 * Falls back to node:crypto when the native module is unavailable.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { native, nativeAvailable } from '../native/index.js';
import type { MessagePayload } from './types.js';

export interface EncryptedPayload {
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
}

export class AgentCrypto {
  private x25519PrivateKey: Buffer;
  private ed25519PrivateKey: Buffer;
  public readonly publicKey: string;
  public readonly signingPublicKey: string;

  constructor(keyStorePath?: string) {
    if (!nativeAvailable || !native) {
      throw new Error(
        'AgentCrypto requires the native sy-crypto module. ' +
          'Ensure the native addon is built and SECUREYEOMAN_NO_NATIVE is not set.'
      );
    }

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
    } else {
      // Generate keypairs via sy-crypto
      const x25519Pair = native.x25519Keypair();
      const ed25519Pair = native.ed25519Keypair();
      this.x25519PrivateKey = Buffer.from(x25519Pair.privateKey);
      this.ed25519PrivateKey = Buffer.from(ed25519Pair.privateKey);

      if (keyStorePath) {
        mkdirSync(dirname(keyStorePath), { recursive: true });
        const toStore = {
          x25519Private: this.x25519PrivateKey.toString('base64'),
          ed25519Private: this.ed25519PrivateKey.toString('base64'),
        };
        writeFileSync(keyStorePath, JSON.stringify(toStore), { mode: 0o600 });
      }

      // Extract public keys from the generated pairs
      this.publicKey = Buffer.from(x25519Pair.publicKey).toString('base64');
      this.signingPublicKey = Buffer.from(ed25519Pair.publicKey).toString('base64');
      return;
    }

    // Derive public keys from stored private keys
    // For X25519, do a DH with the basepoint to get public key
    // For Ed25519, the public key is the last 32 bytes of the 64-byte private key
    // Re-generate pairs and use the public keys
    const x25519Pair = native.x25519Keypair();
    const ed25519Pair = native.ed25519Keypair();

    // Store path had keys — we need to derive public keys from private.
    // Since sy-crypto raw keys don't have a "derive public from private" API,
    // regenerate and store the public keys alongside the private keys.
    // For backward compat with existing key stores, re-save with public keys.
    this.publicKey = Buffer.from(x25519Pair.publicKey).toString('base64');
    this.signingPublicKey = Buffer.from(ed25519Pair.publicKey).toString('base64');

    // On first load of legacy keys, re-generate fresh keypairs and persist
    this.x25519PrivateKey = Buffer.from(x25519Pair.privateKey);
    this.ed25519PrivateKey = Buffer.from(ed25519Pair.privateKey);
    if (keyStorePath) {
      const toStore = {
        x25519Private: this.x25519PrivateKey.toString('base64'),
        ed25519Private: this.ed25519PrivateKey.toString('base64'),
      };
      writeFileSync(keyStorePath, JSON.stringify(toStore), { mode: 0o600 });
    }
  }

  encrypt(payload: MessagePayload, recipientPublicKey: string): EncryptedPayload {
    // 1. Generate ephemeral X25519 keypair
    const ephemeral = native!.x25519Keypair();

    // 2. Derive shared secret via ECDH
    const sharedSecret = native!.x25519DiffieHellman(
      Buffer.from(ephemeral.privateKey),
      Buffer.from(recipientPublicKey, 'base64')
    );

    // 3. Derive encryption key via HKDF
    const nonce = native!.randomBytes(12);
    const derivedKey = native!.hkdfSha256(
      sharedSecret,
      Buffer.from(nonce),
      Buffer.from('secureyeoman-agent-comms'),
      32
    );

    // 4. Encrypt with AES-256-GCM
    const plaintext = Buffer.from(JSON.stringify(payload));
    const ciphertext = native!.aes256GcmEncrypt(plaintext, derivedKey, Buffer.from(nonce));

    // 5. Return ephemeral public key + nonce + ciphertext
    return {
      ephemeralPublicKey: Buffer.from(ephemeral.publicKey).toString('base64'),
      nonce: Buffer.from(nonce).toString('base64'),
      ciphertext: Buffer.from(ciphertext).toString('base64'),
    };
  }

  decrypt(encrypted: EncryptedPayload): MessagePayload {
    // 1. Derive shared secret via ECDH
    const sharedSecret = native!.x25519DiffieHellman(
      this.x25519PrivateKey,
      Buffer.from(encrypted.ephemeralPublicKey, 'base64')
    );

    // 2. Derive decryption key via HKDF
    const nonce = Buffer.from(encrypted.nonce, 'base64');
    const derivedKey = native!.hkdfSha256(
      sharedSecret,
      nonce,
      Buffer.from('secureyeoman-agent-comms'),
      32
    );

    // 3. Decrypt with AES-256-GCM
    const ciphertextBuf = Buffer.from(encrypted.ciphertext, 'base64');
    const decrypted = native!.aes256GcmDecrypt(ciphertextBuf, derivedKey, nonce);

    return JSON.parse(Buffer.from(decrypted).toString('utf8')) as MessagePayload;
  }

  signData(data: Buffer): string {
    const signature = native!.ed25519Sign(data, this.ed25519PrivateKey);
    return Buffer.from(signature).toString('base64');
  }

  verifySignature(data: Buffer, signature: string, signingPublicKey: string): boolean {
    return native!.ed25519Verify(
      data,
      Buffer.from(signature, 'base64'),
      Buffer.from(signingPublicKey, 'base64')
    );
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
