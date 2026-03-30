//! Execution storage — sandboxed execution history.
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRow {
    pub id: String,
    pub session_id: Option<String>,
    pub status: String,
    pub language: Option<String>,
    pub created_at: i64,
    pub duration_ms: Option<i64>,
}

pub async fn list_executions(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ExecutionRow>, sqlx::Error> {
    sqlx::query_as::<_, ExecutionRow>("SELECT id, session_id, status, language, created_at, duration_ms FROM execution.history ORDER BY created_at DESC LIMIT $1 OFFSET $2")
        .bind(limit).bind(offset).fetch_all(pool).await
}
