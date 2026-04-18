//! Persistent key-value memory store with TTL and namespace support.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ENTRIES: usize = 10_000;
const MAX_VALUE_BYTES: usize = 1_048_576; // 1 MB

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    value: serde_json::Value,
    expires_at: Option<u64>,
}

pub struct MemoryStore {
    data: RwLock<HashMap<String, HashMap<String, Entry>>>,
    store_path: String,
}

impl MemoryStore {
    pub fn new() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        let dir = format!("{home}/.secureyeoman-edge");
        let _ = fs::create_dir_all(&dir);
        let store_path = format!("{dir}/memory.json");

        let data = Self::load_from_disk(&store_path);

        Self {
            data: RwLock::new(data),
            store_path,
        }
    }

    fn load_from_disk(path: &str) -> HashMap<String, HashMap<String, Entry>> {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn persist(&self) {
        let data = self.data.read().unwrap();
        if let Ok(json) = serde_json::to_string(&*data) {
            let _ = fs::write(&self.store_path, json);
        }
    }

    fn now_epoch() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    pub fn get(&self, namespace: &str, key: &str) -> Option<serde_json::Value> {
        let data = self.data.read().unwrap();
        let entry = data.get(namespace)?.get(key)?;

        if let Some(exp) = entry.expires_at
            && Self::now_epoch() > exp
        {
            return None;
        }

        Some(entry.value.clone())
    }

    pub fn put(
        &self,
        namespace: &str,
        key: &str,
        value: serde_json::Value,
        ttl_seconds: Option<u64>,
    ) -> Result<(), String> {
        // Check value size
        let val_str = serde_json::to_string(&value).unwrap_or_default();
        if val_str.len() > MAX_VALUE_BYTES {
            return Err(format!(
                "Value too large ({} bytes, max {MAX_VALUE_BYTES})",
                val_str.len()
            ));
        }

        let mut data = self.data.write().unwrap();

        // Check total entry count
        let total: usize = data.values().map(|ns| ns.len()).sum();
        if total >= MAX_ENTRIES {
            return Err(format!("Entry limit reached ({MAX_ENTRIES})"));
        }

        let expires_at = ttl_seconds.map(|ttl| Self::now_epoch() + ttl);

        data.entry(namespace.to_string())
            .or_default()
            .insert(key.to_string(), Entry { value, expires_at });

        drop(data);
        self.persist();
        Ok(())
    }

    pub fn delete(&self, namespace: &str, key: &str) {
        let mut data = self.data.write().unwrap();
        if let Some(ns) = data.get_mut(namespace) {
            ns.remove(key);
            if ns.is_empty() {
                data.remove(namespace);
            }
        }
        drop(data);
        self.persist();
    }

    pub fn list(&self, namespace: &str) -> Vec<String> {
        let data = self.data.read().unwrap();
        let now = Self::now_epoch();

        data.get(namespace)
            .map(|ns| {
                ns.iter()
                    .filter(|(_, e)| e.expires_at.is_none_or(|exp| now <= exp))
                    .map(|(k, _)| k.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn list_namespaces(&self) -> Vec<String> {
        let data = self.data.read().unwrap();
        data.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> MemoryStore {
        // Use a temp path to avoid polluting real data
        let dir = format!("/tmp/sy-edge-test-{}", std::process::id());
        let _ = fs::create_dir_all(&dir);
        MemoryStore {
            data: RwLock::new(HashMap::new()),
            store_path: format!("{dir}/memory.json"),
        }
    }

    #[test]
    fn put_and_get() {
        let store = test_store();
        store
            .put("ns", "key1", serde_json::json!("hello"), None)
            .unwrap();
        let val = store.get("ns", "key1");
        assert_eq!(val, Some(serde_json::json!("hello")));
    }

    #[test]
    fn get_nonexistent_key() {
        let store = test_store();
        assert!(store.get("ns", "missing").is_none());
    }

    #[test]
    fn get_nonexistent_namespace() {
        let store = test_store();
        assert!(store.get("missing_ns", "key").is_none());
    }

    #[test]
    fn delete_key() {
        let store = test_store();
        store.put("ns", "k", serde_json::json!(1), None).unwrap();
        assert!(store.get("ns", "k").is_some());
        store.delete("ns", "k");
        assert!(store.get("ns", "k").is_none());
    }

    #[test]
    fn delete_last_key_removes_namespace() {
        let store = test_store();
        store.put("ns", "only", serde_json::json!(1), None).unwrap();
        assert!(store.list_namespaces().contains(&"ns".to_string()));
        store.delete("ns", "only");
        assert!(!store.list_namespaces().contains(&"ns".to_string()));
    }

    #[test]
    fn list_keys() {
        let store = test_store();
        store.put("ns", "a", serde_json::json!(1), None).unwrap();
        store.put("ns", "b", serde_json::json!(2), None).unwrap();
        let keys = store.list("ns");
        assert_eq!(keys.len(), 2);
        assert!(keys.contains(&"a".to_string()));
        assert!(keys.contains(&"b".to_string()));
    }

    #[test]
    fn list_namespaces() {
        let store = test_store();
        store.put("ns1", "k", serde_json::json!(1), None).unwrap();
        store.put("ns2", "k", serde_json::json!(2), None).unwrap();
        let ns = store.list_namespaces();
        assert!(ns.contains(&"ns1".to_string()));
        assert!(ns.contains(&"ns2".to_string()));
    }

    #[test]
    fn ttl_expired_returns_none() {
        let store = test_store();
        // Set TTL to 0 seconds (already expired)
        store
            .put("ns", "k", serde_json::json!("temp"), Some(0))
            .unwrap();
        // Wait a moment for epoch to advance
        std::thread::sleep(std::time::Duration::from_millis(1100));
        assert!(store.get("ns", "k").is_none());
    }

    #[test]
    fn ttl_not_expired_returns_value() {
        let store = test_store();
        store
            .put("ns", "k", serde_json::json!("temp"), Some(3600))
            .unwrap();
        assert_eq!(store.get("ns", "k"), Some(serde_json::json!("temp")));
    }

    #[test]
    fn value_too_large_rejected() {
        let store = test_store();
        let big_value = serde_json::json!("x".repeat(MAX_VALUE_BYTES + 1));
        let result = store.put("ns", "k", big_value, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too large"));
    }

    #[test]
    fn overwrite_existing_key() {
        let store = test_store();
        store.put("ns", "k", serde_json::json!(1), None).unwrap();
        store.put("ns", "k", serde_json::json!(2), None).unwrap();
        assert_eq!(store.get("ns", "k"), Some(serde_json::json!(2)));
    }

    #[test]
    fn json_value_types() {
        let store = test_store();
        store
            .put("ns", "str", serde_json::json!("hello"), None)
            .unwrap();
        store.put("ns", "num", serde_json::json!(42), None).unwrap();
        store
            .put("ns", "bool", serde_json::json!(true), None)
            .unwrap();
        store
            .put("ns", "null", serde_json::json!(null), None)
            .unwrap();
        store
            .put("ns", "arr", serde_json::json!([1, 2, 3]), None)
            .unwrap();
        store
            .put("ns", "obj", serde_json::json!({"a": 1}), None)
            .unwrap();

        assert_eq!(store.get("ns", "str"), Some(serde_json::json!("hello")));
        assert_eq!(store.get("ns", "num"), Some(serde_json::json!(42)));
        assert_eq!(store.get("ns", "bool"), Some(serde_json::json!(true)));
        assert_eq!(store.get("ns", "null"), Some(serde_json::json!(null)));
        assert_eq!(store.get("ns", "arr"), Some(serde_json::json!([1, 2, 3])));
        assert_eq!(store.get("ns", "obj"), Some(serde_json::json!({"a": 1})));
    }

    #[test]
    fn empty_list_for_missing_namespace() {
        let store = test_store();
        assert!(store.list("nonexistent").is_empty());
    }

    #[test]
    fn delete_nonexistent_is_noop() {
        let store = test_store();
        store.delete("ns", "missing"); // should not panic
    }
}
