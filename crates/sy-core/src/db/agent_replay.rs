//! Agent replay storage — traces via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReplayTraceRow {
    pub id: String,
    pub agent_id: String,
    pub status: String,
    pub depth: i32,
    pub duration_ms: Option<i64>,
    pub chain_json: serde_json::Value,
    pub input_json: Option<serde_json::Value>,
    pub output_json: Option<serde_json::Value>,
    pub created_at: i64,
}

pub async fn list_traces(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ReplayTraceRow>, sqlx::Error> {
    sqlx::query_as::<_, ReplayTraceRow>(
        "SELECT * FROM agent_replay.traces ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_trace(pool: &PgPool, id: &str) -> Result<Option<ReplayTraceRow>, sqlx::Error> {
    sqlx::query_as::<_, ReplayTraceRow>("SELECT * FROM agent_replay.traces WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}
