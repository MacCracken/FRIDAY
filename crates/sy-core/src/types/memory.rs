//! Memory and knowledge types — brain module types.

use serde::{Deserialize, Serialize};

/// Memory type enum matching TS MemoryType.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryType {
    Episodic,
    Semantic,
    Procedural,
    Preference,
}

/// Memory entry matching TS Memory interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality_id: Option<String>,
    pub r#type: MemoryType,
    pub content: String,
    pub source: String,
    #[serde(default)]
    pub context: std::collections::HashMap<String, String>,
    pub importance: f64,
    pub access_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_accessed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Knowledge entry matching TS KnowledgeEntry interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEntry {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality_id: Option<String>,
    pub topic: String,
    pub content: String,
    pub source: String,
    pub confidence: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}
