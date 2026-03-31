//! Replay jobs storage — replay job tracking via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReplayJobRow {
    pub id: String,
    pub name: String,
    pub source_conversation_id: Option<String>,
    pub status: String,
    pub report: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_jobs(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ReplayJobRow>, sqlx::Error> {
    sqlx::query_as::<_, ReplayJobRow>(
        "SELECT * FROM replay.jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_job(pool: &PgPool, id: &str) -> Result<Option<ReplayJobRow>, sqlx::Error> {
    sqlx::query_as::<_, ReplayJobRow>("SELECT * FROM replay.jobs WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}
