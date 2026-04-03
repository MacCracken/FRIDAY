//! PostgreSQL-backed vector store using pgvector extension.
//!
//! Stores embeddings in a `brain.vectors` table with cosine similarity search.
//! Requires the `pgvector` extension to be installed in the database.
//!
//! Migration SQL:
//! ```sql
//! CREATE EXTENSION IF NOT EXISTS vector;
//! CREATE TABLE IF NOT EXISTS brain.vectors (
//!     id TEXT PRIMARY KEY,
//!     embedding vector(1536),
//!     metadata JSONB NOT NULL DEFAULT '{}',
//!     tenant_id TEXT NOT NULL DEFAULT 'default',
//!     created_at BIGINT NOT NULL
//! );
//! CREATE INDEX IF NOT EXISTS idx_vectors_tenant ON brain.vectors (tenant_id);
//! ```

use sqlx::PgPool;

use super::vector::{VectorError, VectorResult, VectorStore, VectorStoreResult};

/// PostgreSQL vector store backed by pgvector extension.
pub struct PgVectorStore {
    pool: PgPool,
    tenant_id: String,
}

impl PgVectorStore {
    pub fn new(pool: PgPool, tenant_id: String) -> Self {
        Self { pool, tenant_id }
    }
}

/// Convert a float slice to a pgvector-compatible string: "[0.1,0.2,0.3]"
fn vec_to_pg(v: &[f32]) -> String {
    let inner: Vec<String> = v.iter().map(|f| format!("{f}")).collect();
    format!("[{}]", inner.join(","))
}

impl VectorStore for PgVectorStore {
    async fn insert(
        &self,
        id: &str,
        vector: &[f32],
        metadata: serde_json::Value,
    ) -> VectorStoreResult<()> {
        let pg_vec = vec_to_pg(vector);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        sqlx::query(
            "INSERT INTO brain.vectors (id, embedding, metadata, tenant_id, created_at)
             VALUES ($1, $2::vector, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET embedding = $2::vector, metadata = $3",
        )
        .bind(id)
        .bind(&pg_vec)
        .bind(&metadata)
        .bind(&self.tenant_id)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| VectorError::Store(e.to_string()))?;

        Ok(())
    }

    async fn insert_batch(
        &self,
        items: &[(String, Vec<f32>, serde_json::Value)],
    ) -> VectorStoreResult<()> {
        // Use a transaction for batch inserts
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| VectorError::Store(e.to_string()))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        for (id, vector, metadata) in items {
            let pg_vec = vec_to_pg(vector);
            sqlx::query(
                "INSERT INTO brain.vectors (id, embedding, metadata, tenant_id, created_at)
                 VALUES ($1, $2::vector, $3, $4, $5)
                 ON CONFLICT (id) DO UPDATE SET embedding = $2::vector, metadata = $3",
            )
            .bind(id)
            .bind(&pg_vec)
            .bind(metadata)
            .bind(&self.tenant_id)
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(|e| VectorError::Store(e.to_string()))?;
        }

        tx.commit()
            .await
            .map_err(|e| VectorError::Store(e.to_string()))?;
        Ok(())
    }

    async fn search(
        &self,
        vector: &[f32],
        limit: usize,
        threshold: f32,
    ) -> VectorStoreResult<Vec<VectorResult>> {
        let pg_vec = vec_to_pg(vector);

        // pgvector cosine distance: <=> returns distance [0, 2], convert to similarity [0, 1]
        let rows: Vec<(String, f64, serde_json::Value)> = sqlx::query_as(
            "SELECT id, 1 - (embedding <=> $1::vector) AS score, metadata
             FROM brain.vectors
             WHERE tenant_id = $2 AND 1 - (embedding <=> $1::vector) >= $3
             ORDER BY embedding <=> $1::vector
             LIMIT $4",
        )
        .bind(&pg_vec)
        .bind(&self.tenant_id)
        .bind(threshold as f64)
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| VectorError::Store(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|(id, score, metadata)| VectorResult {
                id,
                score: score as f32,
                metadata,
            })
            .collect())
    }

    async fn delete(&self, id: &str) -> VectorStoreResult<bool> {
        let result = sqlx::query("DELETE FROM brain.vectors WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| VectorError::Store(e.to_string()))?;
        Ok(result.rows_affected() > 0)
    }

    async fn count(&self) -> VectorStoreResult<usize> {
        let (count,): (i64,) =
            sqlx::query_as("SELECT count(*) FROM brain.vectors WHERE tenant_id = $1")
                .bind(&self.tenant_id)
                .fetch_one(&self.pool)
                .await
                .map_err(|e| VectorError::Store(e.to_string()))?;
        Ok(count as usize)
    }
}

/// Enum-based vector store that dispatches to either in-memory or pgvector.
/// Used to avoid generic proliferation in AppState.
pub enum DynVectorStore {
    InMemory(super::vector::InMemoryVectorStore),
    Postgres(PgVectorStore),
}

impl VectorStore for DynVectorStore {
    async fn insert(
        &self,
        id: &str,
        vector: &[f32],
        metadata: serde_json::Value,
    ) -> VectorStoreResult<()> {
        match self {
            Self::InMemory(s) => s.insert(id, vector, metadata).await,
            Self::Postgres(s) => s.insert(id, vector, metadata).await,
        }
    }

    async fn insert_batch(
        &self,
        items: &[(String, Vec<f32>, serde_json::Value)],
    ) -> VectorStoreResult<()> {
        match self {
            Self::InMemory(s) => s.insert_batch(items).await,
            Self::Postgres(s) => s.insert_batch(items).await,
        }
    }

    async fn search(
        &self,
        vector: &[f32],
        limit: usize,
        threshold: f32,
    ) -> VectorStoreResult<Vec<VectorResult>> {
        match self {
            Self::InMemory(s) => s.search(vector, limit, threshold).await,
            Self::Postgres(s) => s.search(vector, limit, threshold).await,
        }
    }

    async fn delete(&self, id: &str) -> VectorStoreResult<bool> {
        match self {
            Self::InMemory(s) => s.delete(id).await,
            Self::Postgres(s) => s.delete(id).await,
        }
    }

    async fn count(&self) -> VectorStoreResult<usize> {
        match self {
            Self::InMemory(s) => s.count().await,
            Self::Postgres(s) => s.count().await,
        }
    }
}
