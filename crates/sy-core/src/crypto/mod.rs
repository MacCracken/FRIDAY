//! SecureYeoman Cryptographic Primitives
//!
//! Pure Rust implementations of:
//! - SHA-256, MD5 hashing
//! - HMAC-SHA256 signatures
//! - Constant-time comparison
//! - AES-256-GCM encryption/decryption
//! - X25519 key exchange
//! - Ed25519 signing/verification
//! - HKDF-SHA256 key derivation
//! - Cryptographic random bytes

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use md5::Md5;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use x25519_dalek::{PublicKey as X25519Public, StaticSecret};
use zeroize::Zeroizing;

/// SHA-256 hash, returned as lowercase hex.
pub fn sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex_encode(&hasher.finalize())
}

/// MD5 hash, returned as lowercase hex.
/// For non-security cache keys only.
pub fn md5(data: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(data);
    hex_encode(&hasher.finalize())
}

/// HMAC-SHA256 signature, returned as lowercase hex.
pub fn hmac_sha256(data: &[u8], key: &[u8]) -> String {
    let mut mac: Hmac<Sha256> = KeyInit::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    hex_encode(&mac.finalize().into_bytes())
}

/// Constant-time comparison of two byte slices.
/// Returns false if lengths differ (length is leaked, which is acceptable).
pub fn secure_compare(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.ct_eq(b).into()
}

/// AES-256-GCM encrypt. Returns ciphertext with 16-byte auth tag appended.
///
/// - `key`: 32 bytes
/// - `iv`: 12 bytes (nonce)
pub fn aes_256_gcm_encrypt(plaintext: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 32 {
        return Err(format!(
            "AES-256-GCM key must be 32 bytes, got {}",
            key.len()
        ));
    }
    if iv.len() != 12 {
        return Err(format!("AES-256-GCM IV must be 12 bytes, got {}", iv.len()));
    }

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(iv);
    cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("AES-256-GCM encryption failed: {e}"))
}

/// AES-256-GCM decrypt. Input is ciphertext with 16-byte auth tag appended.
///
/// - `key`: 32 bytes
/// - `iv`: 12 bytes (nonce)
pub fn aes_256_gcm_decrypt(ciphertext: &[u8], key: &[u8], iv: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 32 {
        return Err(format!(
            "AES-256-GCM key must be 32 bytes, got {}",
            key.len()
        ));
    }
    if iv.len() != 12 {
        return Err(format!("AES-256-GCM IV must be 12 bytes, got {}", iv.len()));
    }

    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(iv);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("AES-256-GCM decryption failed: {e}"))
}

/// Generate an X25519 keypair. Returns (private_key_32bytes, public_key_32bytes).
pub fn x25519_keypair() -> (Vec<u8>, Vec<u8>) {
    let secret = StaticSecret::random_from_rng(rand::thread_rng());
    let public = X25519Public::from(&secret);
    (secret.to_bytes().to_vec(), public.to_bytes().to_vec())
}

/// X25519 Diffie-Hellman shared secret derivation.
///
/// - `private_key`: 32 bytes (our static secret)
/// - `public_key`: 32 bytes (their public key)
pub fn x25519_diffie_hellman(private_key: &[u8], public_key: &[u8]) -> Result<Vec<u8>, String> {
    if private_key.len() != 32 {
        return Err(format!(
            "X25519 private key must be 32 bytes, got {}",
            private_key.len()
        ));
    }
    if public_key.len() != 32 {
        return Err(format!(
            "X25519 public key must be 32 bytes, got {}",
            public_key.len()
        ));
    }

    let mut sk_bytes = [0u8; 32];
    sk_bytes.copy_from_slice(private_key);
    let secret = StaticSecret::from(sk_bytes);
    let sk_zeroize = Zeroizing::new(sk_bytes);
    let _ = &*sk_zeroize; // ensure it's used

    let mut pk_bytes = [0u8; 32];
    pk_bytes.copy_from_slice(public_key);
    let their_public = X25519Public::from(pk_bytes);

    let shared = secret.diffie_hellman(&their_public);
    Ok(shared.to_bytes().to_vec())
}

/// Generate an Ed25519 keypair. Returns (private_key_32bytes, public_key_32bytes).
pub fn ed25519_keypair() -> (Vec<u8>, Vec<u8>) {
    let signing_key = SigningKey::generate(&mut rand::thread_rng());
    let verifying_key = signing_key.verifying_key();
    (
        signing_key.to_bytes().to_vec(),
        verifying_key.to_bytes().to_vec(),
    )
}

/// Ed25519 sign. Returns 64-byte signature.
///
/// - `data`: message to sign
/// - `private_key`: 32-byte Ed25519 signing key
pub fn ed25519_sign(data: &[u8], private_key: &[u8]) -> Result<Vec<u8>, String> {
    if private_key.len() != 32 {
        return Err(format!(
            "Ed25519 private key must be 32 bytes, got {}",
            private_key.len()
        ));
    }
    let mut sk_bytes = [0u8; 32];
    sk_bytes.copy_from_slice(private_key);
    let signing_key = SigningKey::from_bytes(&sk_bytes);
    let signature = signing_key.sign(data);
    Ok(signature.to_bytes().to_vec())
}

/// Ed25519 verify.
///
/// - `data`: original message
/// - `signature`: 64-byte signature
/// - `public_key`: 32-byte Ed25519 verifying key
pub fn ed25519_verify(data: &[u8], signature: &[u8], public_key: &[u8]) -> Result<bool, String> {
    if public_key.len() != 32 {
        return Err(format!(
            "Ed25519 public key must be 32 bytes, got {}",
            public_key.len()
        ));
    }
    if signature.len() != 64 {
        return Err(format!(
            "Ed25519 signature must be 64 bytes, got {}",
            signature.len()
        ));
    }

    let mut pk_bytes = [0u8; 32];
    pk_bytes.copy_from_slice(public_key);
    let verifying_key =
        VerifyingKey::from_bytes(&pk_bytes).map_err(|e| format!("Invalid public key: {e}"))?;

    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(signature);
    let sig = ed25519_dalek::Signature::from_bytes(&sig_bytes);

    Ok(verifying_key.verify(data, &sig).is_ok())
}

/// HKDF-SHA256 key derivation.
///
/// - `ikm`: input key material
/// - `salt`: optional salt (empty slice = no salt)
/// - `info`: context/application-specific info
/// - `length`: desired output length in bytes
pub fn hkdf_sha256(ikm: &[u8], salt: &[u8], info: &[u8], length: usize) -> Result<Vec<u8>, String> {
    let salt_opt = if salt.is_empty() { None } else { Some(salt) };
    let hkdf = Hkdf::<Sha256>::new(salt_opt, ikm);
    let mut okm = vec![0u8; length];
    hkdf.expand(info, &mut okm)
        .map_err(|e| format!("HKDF expand failed: {e}"))?;
    Ok(okm)
}

/// Generate cryptographically secure random bytes.
pub fn random_bytes(length: usize) -> Vec<u8> {
    let mut buf = vec![0u8; length];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut buf);
    buf
}

/// Encode bytes as lowercase hex string.
fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_empty() {
        assert_eq!(
            sha256(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn test_sha256_hello() {
        assert_eq!(
            sha256(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn test_md5() {
        assert_eq!(md5(b"hello"), "5d41402abc4b2a76b9719d911017c592");
    }

    #[test]
    fn test_hmac_sha256() {
        let result = hmac_sha256(b"hello", b"secret");
        assert_eq!(result.len(), 64); // 32 bytes = 64 hex chars
        // Known HMAC-SHA256("hello", "secret")
        assert_eq!(
            result,
            "88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b"
        );
    }

    #[test]
    fn test_secure_compare() {
        assert!(secure_compare(b"hello", b"hello"));
        assert!(!secure_compare(b"hello", b"world"));
        assert!(!secure_compare(b"hello", b"hell"));
    }

    #[test]
    fn test_aes_256_gcm_roundtrip() {
        let key = random_bytes(32);
        let iv = random_bytes(12);
        let plaintext = b"sensitive data for SecureYeoman";

        let encrypted = aes_256_gcm_encrypt(plaintext, &key, &iv).unwrap();
        let decrypted = aes_256_gcm_decrypt(&encrypted, &key, &iv).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_aes_256_gcm_bad_key() {
        let result = aes_256_gcm_encrypt(b"data", &[0u8; 16], &[0u8; 12]);
        assert!(result.is_err());
    }

    #[test]
    fn test_aes_256_gcm_tampered() {
        let key = random_bytes(32);
        let iv = random_bytes(12);
        let encrypted = aes_256_gcm_encrypt(b"data", &key, &iv).unwrap();

        let mut tampered = encrypted.clone();
        tampered[0] ^= 0xff;
        assert!(aes_256_gcm_decrypt(&tampered, &key, &iv).is_err());
    }

    #[test]
    fn test_x25519_key_exchange() {
        let (sk_a, pk_a) = x25519_keypair();
        let (sk_b, pk_b) = x25519_keypair();

        let shared_a = x25519_diffie_hellman(&sk_a, &pk_b).unwrap();
        let shared_b = x25519_diffie_hellman(&sk_b, &pk_a).unwrap();
        assert_eq!(shared_a, shared_b);
    }

    #[test]
    fn test_ed25519_sign_verify() {
        let (sk, pk) = ed25519_keypair();
        let message = b"sign me please";

        let sig = ed25519_sign(message, &sk).unwrap();
        assert!(ed25519_verify(message, &sig, &pk).unwrap());
        assert!(!ed25519_verify(b"wrong message", &sig, &pk).unwrap());
    }

    #[test]
    fn test_hkdf() {
        let ikm = random_bytes(32);
        let salt = random_bytes(16);
        let info = b"secureyeoman-test";

        let derived = hkdf_sha256(&ikm, &salt, info, 32).unwrap();
        assert_eq!(derived.len(), 32);

        // Same inputs produce same output
        let derived2 = hkdf_sha256(&ikm, &salt, info, 32).unwrap();
        assert_eq!(derived, derived2);
    }

    #[test]
    fn test_random_bytes_length() {
        assert_eq!(random_bytes(16).len(), 16);
        assert_eq!(random_bytes(32).len(), 32);
        assert_eq!(random_bytes(0).len(), 0);
    }

    #[test]
    fn test_random_bytes_not_all_zeros() {
        let bytes = random_bytes(32);
        assert!(bytes.iter().any(|&b| b != 0));
    }

    // ── SHA-256 additional ──────────────────────────────────────────────

    #[test]
    fn test_sha256_binary_data() {
        // Ensure binary (non-UTF8) data hashes correctly
        let data: Vec<u8> = (0u8..=255).collect();
        let hash = sha256(&data);
        assert_eq!(hash.len(), 64);
        // Deterministic
        assert_eq!(sha256(&data), hash);
    }

    #[test]
    fn test_sha256_large_input() {
        let data = vec![0xABu8; 1_000_000];
        let hash = sha256(&data);
        assert_eq!(hash.len(), 64);
    }

    // ── MD5 additional ──────────────────────────────────────────────────

    #[test]
    fn test_md5_empty() {
        assert_eq!(md5(b""), "d41d8cd98f00b204e9800998ecf8427e");
    }

    // ── HMAC additional ─────────────────────────────────────────────────

    #[test]
    fn test_hmac_sha256_empty_key() {
        let result = hmac_sha256(b"data", b"");
        assert_eq!(result.len(), 64);
    }

    #[test]
    fn test_hmac_sha256_empty_data() {
        let result = hmac_sha256(b"", b"key");
        assert_eq!(result.len(), 64);
    }

    #[test]
    fn test_hmac_sha256_different_keys_produce_different_results() {
        let a = hmac_sha256(b"same data", b"key1");
        let b = hmac_sha256(b"same data", b"key2");
        assert_ne!(a, b);
    }

    // ── Secure compare additional ───────────────────────────────────────

    #[test]
    fn test_secure_compare_empty() {
        assert!(secure_compare(b"", b""));
    }

    #[test]
    fn test_secure_compare_single_byte_diff() {
        assert!(!secure_compare(b"\x00", b"\x01"));
    }

    #[test]
    fn test_secure_compare_same_length_different() {
        assert!(!secure_compare(b"aaaa", b"aaab"));
    }

    // ── AES-256-GCM additional ──────────────────────────────────────────

    #[test]
    fn test_aes_256_gcm_empty_plaintext() {
        let key = random_bytes(32);
        let iv = random_bytes(12);
        let encrypted = aes_256_gcm_encrypt(b"", &key, &iv).unwrap();
        let decrypted = aes_256_gcm_decrypt(&encrypted, &key, &iv).unwrap();
        assert!(decrypted.is_empty());
    }

    #[test]
    fn test_aes_256_gcm_bad_iv_length() {
        let result = aes_256_gcm_encrypt(b"data", &[0u8; 32], &[0u8; 8]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("IV must be 12 bytes"));
    }

    #[test]
    fn test_aes_256_gcm_wrong_key_decrypt() {
        let key1 = random_bytes(32);
        let key2 = random_bytes(32);
        let iv = random_bytes(12);
        let encrypted = aes_256_gcm_encrypt(b"secret", &key1, &iv).unwrap();
        assert!(aes_256_gcm_decrypt(&encrypted, &key2, &iv).is_err());
    }

    #[test]
    fn test_aes_256_gcm_different_ivs_produce_different_ciphertext() {
        let key = random_bytes(32);
        let iv1 = random_bytes(12);
        let iv2 = random_bytes(12);
        let e1 = aes_256_gcm_encrypt(b"same data", &key, &iv1).unwrap();
        let e2 = aes_256_gcm_encrypt(b"same data", &key, &iv2).unwrap();
        assert_ne!(e1, e2);
    }

    // ── X25519 additional ───────────────────────────────────────────────

    #[test]
    fn test_x25519_keypair_uniqueness() {
        let (sk1, pk1) = x25519_keypair();
        let (sk2, pk2) = x25519_keypair();
        assert_ne!(sk1, sk2);
        assert_ne!(pk1, pk2);
    }

    #[test]
    fn test_x25519_invalid_key_size() {
        let result = x25519_diffie_hellman(&[0u8; 16], &[0u8; 32]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("32 bytes"));
    }

    #[test]
    fn test_x25519_invalid_pubkey_size() {
        let result = x25519_diffie_hellman(&[0u8; 32], &[0u8; 16]);
        assert!(result.is_err());
    }

    #[test]
    fn test_x25519_key_sizes() {
        let (sk, pk) = x25519_keypair();
        assert_eq!(sk.len(), 32);
        assert_eq!(pk.len(), 32);
    }

    // ── Ed25519 additional ──────────────────────────────────────────────

    #[test]
    fn test_ed25519_keypair_sizes() {
        let (sk, pk) = ed25519_keypair();
        assert_eq!(sk.len(), 32);
        assert_eq!(pk.len(), 32);
    }

    #[test]
    fn test_ed25519_signature_size() {
        let (sk, _) = ed25519_keypair();
        let sig = ed25519_sign(b"test", &sk).unwrap();
        assert_eq!(sig.len(), 64);
    }

    #[test]
    fn test_ed25519_invalid_private_key_size() {
        let result = ed25519_sign(b"test", &[0u8; 16]);
        assert!(result.is_err());
    }

    #[test]
    fn test_ed25519_invalid_signature_size() {
        let (_, pk) = ed25519_keypair();
        let result = ed25519_verify(b"test", &[0u8; 32], &pk);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("64 bytes"));
    }

    #[test]
    fn test_ed25519_invalid_public_key_size() {
        let (sk, _) = ed25519_keypair();
        let sig = ed25519_sign(b"test", &sk).unwrap();
        let result = ed25519_verify(b"test", &sig, &[0u8; 16]);
        assert!(result.is_err());
    }

    #[test]
    fn test_ed25519_wrong_public_key() {
        let (sk, _pk) = ed25519_keypair();
        let (_, other_pk) = ed25519_keypair();
        let sig = ed25519_sign(b"test", &sk).unwrap();
        assert!(!ed25519_verify(b"test", &sig, &other_pk).unwrap());
    }

    #[test]
    fn test_ed25519_empty_message() {
        let (sk, pk) = ed25519_keypair();
        let sig = ed25519_sign(b"", &sk).unwrap();
        assert!(ed25519_verify(b"", &sig, &pk).unwrap());
    }

    // ── HKDF additional ────────────────────────────────────────────────

    #[test]
    fn test_hkdf_empty_salt() {
        let ikm = random_bytes(32);
        let derived = hkdf_sha256(&ikm, b"", b"info", 32).unwrap();
        assert_eq!(derived.len(), 32);
    }

    #[test]
    fn test_hkdf_different_info_produces_different_keys() {
        let ikm = random_bytes(32);
        let d1 = hkdf_sha256(&ikm, b"salt", b"info1", 32).unwrap();
        let d2 = hkdf_sha256(&ikm, b"salt", b"info2", 32).unwrap();
        assert_ne!(d1, d2);
    }

    #[test]
    fn test_hkdf_various_lengths() {
        let ikm = random_bytes(32);
        for len in [16, 32, 48, 64] {
            let derived = hkdf_sha256(&ikm, b"salt", b"info", len).unwrap();
            assert_eq!(derived.len(), len);
        }
    }

    #[test]
    fn test_hkdf_too_long_output() {
        let ikm = random_bytes(32);
        // HKDF-SHA256 max output is 255 * 32 = 8160 bytes
        let result = hkdf_sha256(&ikm, b"salt", b"info", 8161);
        assert!(result.is_err());
    }

    // ── Random bytes additional ─────────────────────────────────────────

    #[test]
    fn test_random_bytes_uniqueness() {
        let a = random_bytes(32);
        let b = random_bytes(32);
        assert_ne!(a, b); // Astronomically unlikely to collide
    }
}
