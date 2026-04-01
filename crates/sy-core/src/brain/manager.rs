//! BrainManager — orchestrates memory, knowledge, embedding, and vector search.
//!
//! Core methods:
//! - `remember()` — store a memory, embed it, index it in vector store
//! - `recall()` — hybrid semantic + full-text search with ACT-R ranking
//! - `learn()` — store a knowledge entry
//! - `query_knowledge()` — search knowledge entries
//! - `get_relevant_context()` — format retrieved items for prompt injection
//! - `forget()` — delete a memory and its vector
//! - `ingest_text()` — chunk text and learn each chunk

use sqlx::PgPool;
use tracing::{debug, warn};

use crate::brain::activation::{actr_activation, composite_score};
use crate::brain::chunker::{self, ChunkOptions};
use crate::brain::embedding::EmbeddingProvider;
use crate::brain::vector::{VectorResult, VectorStore};
use crate::db::brain;

/// Configuration for the brain manager.
pub struct BrainConfig {
    /// Maximum number of memories per tenant. Default: 10_000.
    pub max_memories: i64,
    /// Maximum content length in characters. Default: 4_096.
    pub max_content_length: usize,
    /// Number of memories to include in prompt context. Default: 10.
    pub context_window_memories: usize,
    /// Similarity threshold for vector search. Default: 0.3.
    pub similarity_threshold: f32,
    /// Chunking options for document ingestion.
    pub chunk_options: ChunkOptions,
}

impl Default for BrainConfig {
    fn default() -> Self {
        Self {
            max_memories: 10_000,
            max_content_length: 4_096,
            context_window_memories: 10,
            similarity_threshold: 0.3,
            chunk_options: ChunkOptions::default(),
        }
    }
}

/// The brain manager — orchestrates cognitive operations.
pub struct BrainManager<E: EmbeddingProvider, V: VectorStore> {
    pool: PgPool,
    tenant_id: String,
    config: BrainConfig,
    embedding: E,
    vector_store: V,
}

impl<E: EmbeddingProvider, V: VectorStore> BrainManager<E, V> {
    /// Create a new brain manager.
    pub fn new(
        pool: PgPool,
        tenant_id: String,
        config: BrainConfig,
        embedding: E,
        vector_store: V,
    ) -> Self {
        Self {
            pool,
            tenant_id,
            config,
            embedding,
            vector_store,
        }
    }

    /// Store a memory, embed it, and index it in the vector store.
    pub async fn remember(
        &self,
        memory_type: &str,
        content: &str,
        source: &str,
        context: &serde_json::Value,
        importance: f64,
        personality_id: Option<&str>,
    ) -> Result<brain::MemoryRow, BrainError> {
        // Validate content length
        if content.len() > self.config.max_content_length {
            return Err(BrainError::ContentTooLong {
                len: content.len(),
                max: self.config.max_content_length,
            });
        }

        let id = uuid::Uuid::now_v7().to_string();

        // Store in PostgreSQL
        let row = brain::insert_memory(
            &self.pool,
            &id,
            memory_type,
            content,
            source,
            context,
            importance,
            personality_id,
            &self.tenant_id,
        )
        .await
        .map_err(|e| BrainError::Storage(e.to_string()))?;

        // Embed and index
        if let Err(e) = self.embed_and_index(&id, content, personality_id).await {
            warn!(id, error = %e, "failed to index memory in vector store");
        }

        debug!(id, memory_type, "memory stored");
        Ok(row)
    }

    /// Recall memories using hybrid semantic + full-text search.
    ///
    /// 1. Embed the query and search the vector store
    /// 2. Search full-text via PostgreSQL ILIKE
    /// 3. Merge results using Reciprocal Rank Fusion (RRF)
    /// 4. Rank by composite score (content match + ACT-R activation)
    pub async fn recall(
        &self,
        query: &str,
        limit: usize,
        personality_id: Option<&str>,
    ) -> Result<Vec<ScoredMemory>, BrainError> {
        let limit_i64 = limit as i64;

        // Vector search path
        let vector_results = match self.embed_and_search(query, limit, personality_id).await {
            Ok(results) => results,
            Err(e) => {
                warn!(error = %e, "vector search failed, falling back to FTS only");
                Vec::new()
            }
        };

        // Full-text search path
        let fts_results = brain::search_memories(&self.pool, &self.tenant_id, query, limit_i64)
            .await
            .map_err(|e| BrainError::Storage(e.to_string()))?;

        // Build scored results from vector matches
        let mut scored: Vec<ScoredMemory> = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        for vr in &vector_results {
            if let Ok(Some(mem)) = brain::get_memory(&self.pool, &vr.id, &self.tenant_id).await {
                let age_days = age_in_days(mem.created_at);
                let activation = actr_activation(mem.access_count as u32, age_days);
                let score = composite_score(
                    vr.score as f64,
                    activation,
                    0.0, // hebbian boost (not implemented yet)
                    0.0, // salience (not implemented yet)
                    mem.importance.max(0.1),
                );

                seen_ids.insert(mem.id.clone());
                scored.push(ScoredMemory {
                    memory: mem,
                    score,
                    source: MatchSource::Vector,
                });
            }
        }

        // Merge FTS results (RRF: add rank-based score for FTS hits)
        for (rank, mem) in fts_results.iter().enumerate() {
            if seen_ids.contains(&mem.id) {
                // Already in vector results — boost the existing score
                if let Some(existing) = scored.iter_mut().find(|s| s.memory.id == mem.id) {
                    let rrf_bonus = 1.0 / (60.0 + rank as f64);
                    existing.score += rrf_bonus;
                    existing.source = MatchSource::Hybrid;
                }
            } else {
                let age_days = age_in_days(mem.created_at);
                let activation = actr_activation(mem.access_count as u32, age_days);
                let rrf_score = 1.0 / (60.0 + rank as f64);
                let score =
                    composite_score(rrf_score, activation, 0.0, 0.0, mem.importance.max(0.1));
                scored.push(ScoredMemory {
                    memory: mem.clone(),
                    score,
                    source: MatchSource::FullText,
                });
            }
        }

        // Sort by composite score descending
        scored.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        scored.truncate(limit);

        // Touch accessed memories (update access count + last_accessed_at)
        for sm in &scored {
            let _ = brain::touch_memory(&self.pool, &sm.memory.id, &self.tenant_id).await;
        }

        Ok(scored)
    }

    /// Store a knowledge entry.
    pub async fn learn(
        &self,
        topic: &str,
        content: &str,
        source: &str,
        confidence: f64,
        personality_id: Option<&str>,
    ) -> Result<brain::KnowledgeRow, BrainError> {
        if content.len() > self.config.max_content_length {
            return Err(BrainError::ContentTooLong {
                len: content.len(),
                max: self.config.max_content_length,
            });
        }

        let id = uuid::Uuid::now_v7().to_string();
        let row = brain::insert_knowledge(
            &self.pool,
            &id,
            topic,
            content,
            source,
            confidence,
            personality_id,
            &self.tenant_id,
        )
        .await
        .map_err(|e| BrainError::Storage(e.to_string()))?;

        // Index knowledge in vector store too
        if let Err(e) = self.embed_and_index(&id, content, personality_id).await {
            warn!(id, error = %e, "failed to index knowledge in vector store");
        }

        debug!(id, topic, "knowledge stored");
        Ok(row)
    }

    /// Search knowledge entries.
    pub async fn query_knowledge(
        &self,
        query: &str,
        personality_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<brain::KnowledgeRow>, BrainError> {
        brain::query_knowledge(
            &self.pool,
            &self.tenant_id,
            query,
            personality_id,
            limit as i64,
        )
        .await
        .map_err(|e| BrainError::Storage(e.to_string()))
    }

    /// Format retrieved memories and knowledge for system prompt injection.
    ///
    /// Returns a markdown section ready to append to the system prompt.
    pub async fn get_relevant_context(
        &self,
        query: &str,
        personality_id: Option<&str>,
    ) -> Result<String, BrainError> {
        let limit = self.config.context_window_memories;

        let memories = self.recall(query, limit / 2, personality_id).await?;
        let knowledge = self
            .query_knowledge(query, personality_id, limit / 2)
            .await?;

        if memories.is_empty() && knowledge.is_empty() {
            return Ok(String::new());
        }

        let mut lines = vec!["## Relevant Context".to_string()];

        if !memories.is_empty() {
            lines.push(String::new());
            lines.push("### Memories".to_string());
            for sm in &memories {
                lines.push(format!(
                    "- [{}] {} (importance: {:.1}, source: {})",
                    sm.memory.r#type, sm.memory.content, sm.memory.importance, sm.memory.source
                ));
            }
        }

        if !knowledge.is_empty() {
            lines.push(String::new());
            lines.push("### Knowledge".to_string());
            for ke in &knowledge {
                lines.push(format!(
                    "- **{}**: {} (confidence: {:.1})",
                    ke.topic, ke.content, ke.confidence
                ));
            }
        }

        Ok(lines.join("\n"))
    }

    /// Delete a memory and its vector index entry.
    pub async fn forget(&self, id: &str) -> Result<bool, BrainError> {
        let deleted = brain::delete_memory(&self.pool, id, &self.tenant_id)
            .await
            .map_err(|e| BrainError::Storage(e.to_string()))?;

        if deleted {
            let _ = self.vector_store.delete(id).await;
        }

        Ok(deleted)
    }

    /// Ingest text by chunking and learning each chunk as a knowledge entry.
    pub async fn ingest_text(
        &self,
        title: &str,
        content: &str,
        source: &str,
        personality_id: Option<&str>,
    ) -> Result<usize, BrainError> {
        let chunks = chunker::chunk(
            content,
            Some(ChunkOptions {
                max_tokens: self.config.chunk_options.max_tokens,
                overlap_fraction: self.config.chunk_options.overlap_fraction,
            }),
        );

        let mut ingested = 0;
        for chunk in &chunks {
            let topic = if chunks.len() == 1 {
                title.to_string()
            } else {
                format!("{title} (chunk {}/{})", chunk.index + 1, chunks.len())
            };

            self.learn(&topic, &chunk.text, source, 0.8, personality_id)
                .await?;
            ingested += 1;
        }

        debug!(title, chunks = ingested, "text ingested");
        Ok(ingested)
    }

    /// Get brain statistics.
    pub async fn stats(&self) -> Result<brain::BrainStats, BrainError> {
        brain::get_stats(&self.pool, &self.tenant_id)
            .await
            .map_err(|e| BrainError::Storage(e.to_string()))
    }

    // ── Private helpers ──────────────────────────────────────────────

    async fn embed_and_index(
        &self,
        id: &str,
        content: &str,
        personality_id: Option<&str>,
    ) -> Result<(), BrainError> {
        let vectors = self
            .embedding
            .embed(&[content.to_string()])
            .await
            .map_err(|e| BrainError::Embedding(e.to_string()))?;

        if let Some(vector) = vectors.into_iter().next() {
            let metadata = serde_json::json!({
                "personalityId": personality_id,
                "tenantId": self.tenant_id,
            });
            self.vector_store
                .insert(id, &vector, metadata)
                .await
                .map_err(|e| BrainError::VectorStore(e.to_string()))?;
        }

        Ok(())
    }

    async fn embed_and_search(
        &self,
        query: &str,
        limit: usize,
        _personality_id: Option<&str>,
    ) -> Result<Vec<VectorResult>, BrainError> {
        let vectors = self
            .embedding
            .embed(&[query.to_string()])
            .await
            .map_err(|e| BrainError::Embedding(e.to_string()))?;

        let query_vec = vectors
            .into_iter()
            .next()
            .ok_or_else(|| BrainError::Embedding("no embedding returned".to_string()))?;

        self.vector_store
            .search(&query_vec, limit, self.config.similarity_threshold)
            .await
            .map_err(|e| BrainError::VectorStore(e.to_string()))
    }
}

/// A memory with its composite relevance score.
#[derive(Debug, Clone)]
pub struct ScoredMemory {
    pub memory: brain::MemoryRow,
    pub score: f64,
    pub source: MatchSource,
}

/// How a memory was matched during recall.
#[derive(Debug, Clone, Copy)]
pub enum MatchSource {
    Vector,
    FullText,
    Hybrid,
}

/// Brain error type.
#[derive(Debug, thiserror::Error)]
pub enum BrainError {
    #[error("storage error: {0}")]
    Storage(String),
    #[error("embedding error: {0}")]
    Embedding(String),
    #[error("vector store error: {0}")]
    VectorStore(String),
    #[error("content too long: {len} chars (max {max})")]
    ContentTooLong { len: usize, max: usize },
}

/// Helper: compute age in days from a millisecond timestamp.
fn age_in_days(created_at_ms: i64) -> f64 {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let elapsed_ms = (now_ms - created_at_ms).max(0);
    elapsed_ms as f64 / (1000.0 * 60.0 * 60.0 * 24.0)
}
