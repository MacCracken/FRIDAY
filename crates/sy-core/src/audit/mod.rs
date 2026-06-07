//! HMAC-SHA256 Linked Audit Chain
//!
//! Append-only cryptographic audit log. Each entry is signed with
//! HMAC-SHA256(entryHash:previousHash:sequence, signingKey) — the strictly
//! increasing `sequence` binds an entry to its position, so reordering or
//! middle-deletion is detectable. The chain also maintains a signed head
//! commitment HMAC(lastHash:count, signingKey); verify() recomputes it from the
//! actual entries, so dropping the most recent entries (tail truncation) — which
//! a plain forward hash-walk cannot catch — is detected too.
//!
//! Genesis block starts with previousHash = "0000...0000" (64 zeros).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const CHAIN_VERSION: &str = "1.1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub correlation_id: String,
    pub event: String,
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    pub timestamp: u64,
    /// Strictly-increasing 0-based position in the chain, bound into the
    /// signature so reordering / middle-deletion is detectable.
    #[serde(default)]
    pub sequence: u64,
    pub integrity: IntegrityFields,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityFields {
    pub version: String,
    pub signature: String,
    pub previous_entry_hash: String,
}

/// In-memory audit chain implementation.
pub struct AuditChain {
    signing_key: String,
    last_hash: String,
    /// Signed commitment to (last_hash, count). Updated on every append; checked
    /// by verify() to detect tail truncation.
    head_signature: String,
    entries: Vec<AuditEntry>,
}

impl AuditChain {
    pub fn new(signing_key: &str) -> Self {
        Self {
            signing_key: signing_key.to_string(),
            last_hash: GENESIS_HASH.to_string(),
            head_signature: compute_head(GENESIS_HASH, 0, signing_key),
            entries: Vec::new(),
        }
    }

    /// Record a new audit entry.
    pub fn record(
        &mut self,
        event: &str,
        level: &str,
        message: &str,
        user_id: Option<&str>,
        task_id: Option<&str>,
        metadata: Option<serde_json::Value>,
    ) -> AuditEntry {
        let id = generate_id();
        let correlation_id = generate_id();
        let timestamp = now_epoch_ms();

        // Build entry without integrity first (for hashing)
        let mut entry_data = BTreeMap::new();
        entry_data.insert("id", serde_json::Value::String(id.clone()));
        entry_data.insert(
            "correlationId",
            serde_json::Value::String(correlation_id.clone()),
        );
        entry_data.insert("event", serde_json::Value::String(event.to_string()));
        entry_data.insert("level", serde_json::Value::String(level.to_string()));
        entry_data.insert("message", serde_json::Value::String(message.to_string()));
        entry_data.insert("timestamp", serde_json::Value::Number(timestamp.into()));
        if let Some(uid) = &user_id {
            entry_data.insert("userId", serde_json::Value::String(uid.to_string()));
        }
        if let Some(tid) = &task_id {
            entry_data.insert("taskId", serde_json::Value::String(tid.to_string()));
        }
        if let Some(ref meta) = metadata {
            entry_data.insert("metadata", meta.clone());
        }

        // Compute entry hash using sorted JSON (JSONB stability)
        let sorted_json = serde_json::to_string(&entry_data).unwrap_or_default();
        let entry_hash = crate::crypto::sha256(sorted_json.as_bytes());

        // Sequence binds the entry to its position in the chain.
        let sequence = self.entries.len() as u64;

        // Compute signature: HMAC-SHA256(entryHash:previousHash:sequence, signingKey)
        let sig_input = format!("{}:{}:{}", entry_hash, self.last_hash, sequence);
        let signature =
            crate::crypto::hmac_sha256(sig_input.as_bytes(), self.signing_key.as_bytes());

        let entry = AuditEntry {
            id,
            correlation_id,
            event: event.to_string(),
            level: level.to_string(),
            message: message.to_string(),
            user_id: user_id.map(|s| s.to_string()),
            task_id: task_id.map(|s| s.to_string()),
            metadata,
            timestamp,
            sequence,
            integrity: IntegrityFields {
                version: CHAIN_VERSION.to_string(),
                signature,
                previous_entry_hash: self.last_hash.clone(),
            },
        };

        self.last_hash = entry_hash;
        self.entries.push(entry.clone());
        // Re-sign the head over the new (last_hash, count).
        self.head_signature = compute_head(
            &self.last_hash,
            self.entries.len() as u64,
            &self.signing_key,
        );
        entry
    }

    /// Verify the entire audit chain. Returns (valid, error_message).
    pub fn verify(&self) -> (bool, Option<String>) {
        let mut prev_hash = GENESIS_HASH.to_string();

        for (i, entry) in self.entries.iter().enumerate() {
            // Check previous hash link
            if entry.integrity.previous_entry_hash != prev_hash {
                return (
                    false,
                    Some(format!(
                        "Entry {} ({}): previous hash mismatch",
                        i, entry.id
                    )),
                );
            }

            // Sequence continuity — detects reordering and middle-deletion.
            if entry.sequence != i as u64 {
                return (
                    false,
                    Some(format!(
                        "Entry {} ({}): sequence mismatch (expected {}, got {})",
                        i, entry.id, i, entry.sequence
                    )),
                );
            }

            // Recompute entry hash
            let entry_hash = self.compute_entry_hash(entry);

            // Verify signature (binds entryHash, previousHash and sequence)
            let sig_input = format!("{}:{}:{}", entry_hash, prev_hash, entry.sequence);
            let expected_sig =
                crate::crypto::hmac_sha256(sig_input.as_bytes(), self.signing_key.as_bytes());

            if !crate::crypto::secure_compare(
                entry.integrity.signature.as_bytes(),
                expected_sig.as_bytes(),
            ) {
                return (
                    false,
                    Some(format!(
                        "Entry {} ({}): signature verification failed",
                        i, entry.id
                    )),
                );
            }

            prev_hash = entry_hash;
        }

        // Head commitment — detects tail truncation. The signed head over
        // (last_hash, count) cannot be re-forged without the signing key, so a
        // dropped tail leaves a head that no longer matches the actual entries.
        let expected_head = compute_head(&prev_hash, self.entries.len() as u64, &self.signing_key);
        if !crate::crypto::secure_compare(self.head_signature.as_bytes(), expected_head.as_bytes())
        {
            return (
                false,
                Some("audit chain head commitment mismatch (possible truncation)".to_string()),
            );
        }

        (true, None)
    }

    /// Get the total number of entries.
    pub fn count(&self) -> usize {
        self.entries.len()
    }

    /// Get the last entry hash.
    pub fn last_hash(&self) -> &str {
        &self.last_hash
    }

    /// Update the signing key (records a rotation event).
    pub fn update_signing_key(&mut self, new_key: &str) {
        // Record rotation with OLD key
        self.record(
            "signing_key_rotation",
            "info",
            "Audit chain signing key rotated",
            None,
            None,
            None,
        );
        self.signing_key = new_key.to_string();
    }

    fn compute_entry_hash(&self, entry: &AuditEntry) -> String {
        let mut data = BTreeMap::new();
        data.insert("id", serde_json::Value::String(entry.id.clone()));
        data.insert(
            "correlationId",
            serde_json::Value::String(entry.correlation_id.clone()),
        );
        data.insert("event", serde_json::Value::String(entry.event.clone()));
        data.insert("level", serde_json::Value::String(entry.level.clone()));
        data.insert("message", serde_json::Value::String(entry.message.clone()));
        data.insert(
            "timestamp",
            serde_json::Value::Number(entry.timestamp.into()),
        );
        if let Some(ref uid) = entry.user_id {
            data.insert("userId", serde_json::Value::String(uid.clone()));
        }
        if let Some(ref tid) = entry.task_id {
            data.insert("taskId", serde_json::Value::String(tid.clone()));
        }
        if let Some(ref meta) = entry.metadata {
            data.insert("metadata", meta.clone());
        }

        let json = serde_json::to_string(&data).unwrap_or_default();
        crate::crypto::sha256(json.as_bytes())
    }
}

/// Signed commitment to the chain head: HMAC-SHA256(last_hash:count, signing_key).
/// Lets verify() detect tail truncation that a forward hash-walk would miss.
fn compute_head(last_hash: &str, count: u64, signing_key: &str) -> String {
    let input = format!("{last_hash}:{count}");
    crate::crypto::hmac_sha256(input.as_bytes(), signing_key.as_bytes())
}

fn generate_id() -> String {
    let bytes = crate::crypto::random_bytes(16);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_and_verify() {
        let mut chain = AuditChain::new("test-signing-key");
        chain.record(
            "user.login",
            "info",
            "User logged in",
            Some("user-1"),
            None,
            None,
        );
        chain.record(
            "task.create",
            "info",
            "Task created",
            None,
            Some("task-1"),
            None,
        );

        let (valid, err) = chain.verify();
        assert!(valid, "Chain should be valid: {:?}", err);
        assert_eq!(chain.count(), 2);
    }

    #[test]
    fn genesis_hash() {
        let chain = AuditChain::new("key");
        assert_eq!(chain.last_hash(), GENESIS_HASH);
    }

    #[test]
    fn tamper_detection() {
        let mut chain = AuditChain::new("key");
        chain.record("event", "info", "msg", None, None, None);
        chain.record("event2", "info", "msg2", None, None, None);

        // Tamper with an entry
        chain.entries[0].message = "TAMPERED".to_string();

        let (valid, err) = chain.verify();
        assert!(!valid);
        assert!(err.unwrap().contains("signature verification failed"));
    }

    #[test]
    fn key_rotation() {
        let mut chain = AuditChain::new("old-key");
        chain.record("before", "info", "before rotation", None, None, None);
        chain.update_signing_key("new-key");
        chain.record("after", "info", "after rotation", None, None, None);

        // before + rotation event + after
        assert_eq!(chain.count(), 3);
    }

    #[test]
    fn empty_chain_verifies() {
        let chain = AuditChain::new("key");
        let (valid, err) = chain.verify();
        assert!(valid);
        assert!(err.is_none());
        assert_eq!(chain.count(), 0);
    }

    #[test]
    fn single_entry_verifies() {
        let mut chain = AuditChain::new("key");
        chain.record("test", "info", "single entry", None, None, None);
        let (valid, _) = chain.verify();
        assert!(valid);
    }

    #[test]
    fn tamper_middle_entry() {
        let mut chain = AuditChain::new("key");
        chain.record("e1", "info", "first", None, None, None);
        chain.record("e2", "info", "second", None, None, None);
        chain.record("e3", "info", "third", None, None, None);

        chain.entries[1].message = "TAMPERED".into();
        let (valid, err) = chain.verify();
        assert!(!valid);
        assert!(err.unwrap().contains("Entry 1"));
    }

    #[test]
    fn tamper_last_entry() {
        let mut chain = AuditChain::new("key");
        chain.record("e1", "info", "first", None, None, None);
        chain.record("e2", "info", "second", None, None, None);

        chain.entries[1].event = "TAMPERED".into();
        let (valid, err) = chain.verify();
        assert!(!valid);
        assert!(err.unwrap().contains("Entry 1"));
    }

    #[test]
    fn tail_truncation_detected() {
        let mut chain = AuditChain::new("key");
        chain.record("e1", "info", "first", None, None, None);
        chain.record("e2", "info", "second", None, None, None);
        chain.record("e3", "info", "third", None, None, None);

        // Attacker drops the two most recent entries. The remaining prefix is
        // internally consistent, but the signed head no longer matches.
        chain.entries.truncate(1);
        let (valid, err) = chain.verify();
        assert!(!valid, "tail truncation must be detected");
        assert!(err.unwrap().contains("head commitment"));
    }

    #[test]
    fn reorder_detected_via_sequence() {
        let mut chain = AuditChain::new("key");
        chain.record("e1", "info", "first", None, None, None);
        chain.record("e2", "info", "second", None, None, None);
        chain.entries.swap(0, 1);
        let (valid, _) = chain.verify();
        assert!(!valid, "reordering must be detected");
    }

    #[test]
    fn tamper_previous_hash_link() {
        let mut chain = AuditChain::new("key");
        chain.record("e1", "info", "first", None, None, None);
        chain.record("e2", "info", "second", None, None, None);

        chain.entries[1].integrity.previous_entry_hash = "deadbeef".repeat(8);
        let (valid, err) = chain.verify();
        assert!(!valid);
        assert!(err.unwrap().contains("previous hash mismatch"));
    }

    #[test]
    fn entry_with_all_optional_fields() {
        let mut chain = AuditChain::new("key");
        let meta = serde_json::json!({"action": "delete", "count": 42, "nested": {"a": true}});
        chain.record(
            "task.execute",
            "warn",
            "Task executed with metadata",
            Some("user-123"),
            Some("task-456"),
            Some(meta),
        );
        let (valid, _) = chain.verify();
        assert!(valid);
        assert_eq!(chain.entries[0].user_id.as_deref(), Some("user-123"));
        assert_eq!(chain.entries[0].task_id.as_deref(), Some("task-456"));
        assert!(chain.entries[0].metadata.is_some());
    }

    #[test]
    fn special_characters_in_message() {
        let mut chain = AuditChain::new("key");
        chain.record(
            "test",
            "info",
            "line1\nline2\ttab \"quotes\" \\backslash",
            None,
            None,
            None,
        );
        let (valid, _) = chain.verify();
        assert!(valid);
    }

    #[test]
    fn hash_changes_with_each_entry() {
        let mut chain = AuditChain::new("key");
        let h0 = chain.last_hash().to_string();

        chain.record("e1", "info", "first", None, None, None);
        let h1 = chain.last_hash().to_string();
        assert_ne!(h0, h1);

        chain.record("e2", "info", "second", None, None, None);
        let h2 = chain.last_hash().to_string();
        assert_ne!(h1, h2);
    }

    #[test]
    fn entry_ids_are_unique() {
        let mut chain = AuditChain::new("key");
        chain.record("e1", "info", "first", None, None, None);
        chain.record("e2", "info", "second", None, None, None);
        assert_ne!(chain.entries[0].id, chain.entries[1].id);
    }

    #[test]
    fn integrity_version_is_set() {
        let mut chain = AuditChain::new("key");
        chain.record("test", "info", "msg", None, None, None);
        assert_eq!(chain.entries[0].integrity.version, "1.1.0");
    }

    #[test]
    fn many_entries_verify() {
        let mut chain = AuditChain::new("key");
        for i in 0..100 {
            chain.record("bulk", "info", &format!("entry {i}"), None, None, None);
        }
        let (valid, _) = chain.verify();
        assert!(valid);
        assert_eq!(chain.count(), 100);
    }
}
