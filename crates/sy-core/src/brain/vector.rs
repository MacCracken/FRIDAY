//! Vector store trait — provider-agnostic vector storage and search.
//!
//! Implementations: FAISS, Qdrant, Chroma, AGNOS, Daimon.
//! The brain manager uses this interface to store and search embeddings
//! without knowing which backend is active.

use std::future::Future;

/// A vector search result with score and metadata.
#[derive(Debug, Clone)]
pub struct VectorResult {
    /// ID of the stored item (memory or knowledge entry).
    pub id: String,
    /// Cosine similarity score [0, 1].
    pub score: f32,
    /// Optional metadata stored alongside the vector.
    pub metadata: serde_json::Value,
}

/// Error from a vector store operation.
#[derive(Debug, thiserror::Error)]
pub enum VectorError {
    #[error("vector store error: {0}")]
    Store(String),
    #[error("dimension mismatch: expected {expected}, got {got}")]
    DimensionMismatch { expected: usize, got: usize },
}

pub type VectorStoreResult<T> = Result<T, VectorError>;

/// Provider-agnostic vector storage and search interface.
pub trait VectorStore: Send + Sync {
    /// Insert a single vector with its ID and optional metadata.
    fn insert(
        &self,
        id: &str,
        vector: &[f32],
        metadata: serde_json::Value,
    ) -> impl Future<Output = VectorStoreResult<()>> + Send;

    /// Insert a batch of vectors.
    fn insert_batch(
        &self,
        items: &[(String, Vec<f32>, serde_json::Value)],
    ) -> impl Future<Output = VectorStoreResult<()>> + Send;

    /// Search for nearest neighbors.
    ///
    /// Returns up to `limit` results with score >= `threshold`.
    fn search(
        &self,
        vector: &[f32],
        limit: usize,
        threshold: f32,
    ) -> impl Future<Output = VectorStoreResult<Vec<VectorResult>>> + Send;

    /// Delete a vector by ID.
    fn delete(&self, id: &str) -> impl Future<Output = VectorStoreResult<bool>> + Send;

    /// Count stored vectors.
    fn count(&self) -> impl Future<Output = VectorStoreResult<usize>> + Send;
}

/// In-memory vector store for testing and small-scale use.
///
/// Uses brute-force cosine similarity. Not suitable for production
/// with large datasets — use FAISS/Qdrant/Chroma instead.
pub struct InMemoryVectorStore {
    vectors: tokio::sync::RwLock<Vec<(String, Vec<f32>, serde_json::Value)>>,
}

impl InMemoryVectorStore {
    pub fn new() -> Self {
        Self {
            vectors: tokio::sync::RwLock::new(Vec::new()),
        }
    }
}

impl Default for InMemoryVectorStore {
    fn default() -> Self {
        Self::new()
    }
}

/// Cosine similarity between two vectors.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom < f32::EPSILON {
        0.0
    } else {
        dot / denom
    }
}

impl VectorStore for InMemoryVectorStore {
    async fn insert(
        &self,
        id: &str,
        vector: &[f32],
        metadata: serde_json::Value,
    ) -> VectorStoreResult<()> {
        let mut store = self.vectors.write().await;
        // Upsert: remove existing with same ID
        store.retain(|(existing_id, _, _)| existing_id != id);
        store.push((id.to_string(), vector.to_vec(), metadata));
        Ok(())
    }

    async fn insert_batch(
        &self,
        items: &[(String, Vec<f32>, serde_json::Value)],
    ) -> VectorStoreResult<()> {
        let mut store = self.vectors.write().await;
        for (id, vector, metadata) in items {
            store.retain(|(existing_id, _, _)| existing_id != id);
            store.push((id.clone(), vector.clone(), metadata.clone()));
        }
        Ok(())
    }

    async fn search(
        &self,
        vector: &[f32],
        limit: usize,
        threshold: f32,
    ) -> VectorStoreResult<Vec<VectorResult>> {
        let store = self.vectors.read().await;
        let mut results: Vec<VectorResult> = store
            .iter()
            .map(|(id, v, meta)| {
                let score = cosine_similarity(vector, v);
                VectorResult {
                    id: id.clone(),
                    score,
                    metadata: meta.clone(),
                }
            })
            .filter(|r| r.score >= threshold)
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(limit);
        Ok(results)
    }

    async fn delete(&self, id: &str) -> VectorStoreResult<bool> {
        let mut store = self.vectors.write().await;
        let before = store.len();
        store.retain(|(existing_id, _, _)| existing_id != id);
        Ok(store.len() < before)
    }

    async fn count(&self) -> VectorStoreResult<usize> {
        Ok(self.vectors.read().await.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_identical_vectors() {
        let a = vec![1.0, 0.0, 0.0];
        let score = cosine_similarity(&a, &a);
        assert!((score - 1.0).abs() < 0.001);
    }

    #[test]
    fn cosine_orthogonal_vectors() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        let score = cosine_similarity(&a, &b);
        assert!(score.abs() < 0.001);
    }

    #[test]
    fn cosine_opposite_vectors() {
        let a = vec![1.0, 0.0];
        let b = vec![-1.0, 0.0];
        let score = cosine_similarity(&a, &b);
        assert!((score + 1.0).abs() < 0.001);
    }

    #[tokio::test]
    async fn in_memory_insert_and_search() {
        let store = InMemoryVectorStore::new();
        store
            .insert("a", &[1.0, 0.0, 0.0], serde_json::json!({"type": "test"}))
            .await
            .unwrap();
        store
            .insert("b", &[0.9, 0.1, 0.0], serde_json::json!({"type": "test"}))
            .await
            .unwrap();
        store
            .insert("c", &[0.0, 1.0, 0.0], serde_json::json!({"type": "test"}))
            .await
            .unwrap();

        let results = store.search(&[1.0, 0.0, 0.0], 2, 0.5).await.unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].id, "a");
        assert!(results[0].score > results[1].score);
    }

    #[tokio::test]
    async fn in_memory_delete() {
        let store = InMemoryVectorStore::new();
        store
            .insert("a", &[1.0, 0.0], serde_json::json!({}))
            .await
            .unwrap();
        assert_eq!(store.count().await.unwrap(), 1);
        assert!(store.delete("a").await.unwrap());
        assert_eq!(store.count().await.unwrap(), 0);
        assert!(!store.delete("a").await.unwrap()); // already gone
    }

    #[tokio::test]
    async fn in_memory_upsert() {
        let store = InMemoryVectorStore::new();
        store
            .insert("a", &[1.0, 0.0], serde_json::json!({}))
            .await
            .unwrap();
        store
            .insert("a", &[0.0, 1.0], serde_json::json!({}))
            .await
            .unwrap();
        assert_eq!(store.count().await.unwrap(), 1);
    }

    #[tokio::test]
    async fn search_respects_threshold() {
        let store = InMemoryVectorStore::new();
        store
            .insert("a", &[1.0, 0.0], serde_json::json!({}))
            .await
            .unwrap();
        store
            .insert("b", &[0.0, 1.0], serde_json::json!({}))
            .await
            .unwrap();

        let results = store.search(&[1.0, 0.0], 10, 0.9).await.unwrap();
        assert_eq!(results.len(), 1); // only "a" is above 0.9
    }
}
