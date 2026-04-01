//! Batch inference job storage — submit/track async AI inference jobs via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BatchJobRow {
    pub id: String,
    pub tenant_id: String,
    /// "pending" | "running" | "completed" | "failed" | "cancelled"
    pub status: String,
    pub config: serde_json::Value,
    pub results: Option<serde_json::Value>,
    pub error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_job(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    config: &serde_json::Value,
) -> Result<BatchJobRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, BatchJobRow>(
        "INSERT INTO ai_batch.jobs (id, tenant_id, status, config, results, error, created_at, updated_at)
         VALUES ($1, $2, 'pending', $3, NULL, NULL, $4, $4) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn get_job(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<Option<BatchJobRow>, sqlx::Error> {
    sqlx::query_as::<_, BatchJobRow>("SELECT * FROM ai_batch.jobs WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(pool)
        .await
}

pub async fn list_jobs(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<BatchJobRow>, sqlx::Error> {
    sqlx::query_as::<_, BatchJobRow>(
        "SELECT * FROM ai_batch.jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

/// Transition a job to "cancelled". Only cancels jobs that are still pending or running.
pub async fn cancel_job(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<Option<BatchJobRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, BatchJobRow>(
        "UPDATE ai_batch.jobs
         SET status = 'cancelled', updated_at = $3
         WHERE id = $1 AND tenant_id = $2 AND status IN ('pending', 'running')
         RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(now)
    .fetch_optional(pool)
    .await
}
