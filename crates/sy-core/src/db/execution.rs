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

/// Execution session row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionSessionRow {
    pub id: String,
    pub status: String,
    pub created_at: i64,
}

pub async fn list_executions(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ExecutionRow>, sqlx::Error> {
    sqlx::query_as::<_, ExecutionRow>(
        "SELECT id, session_id, status, language, created_at, duration_ms FROM execution.history ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

/// Get a single execution by ID.
pub async fn get_execution(pool: &PgPool, id: &str) -> Result<Option<ExecutionRow>, sqlx::Error> {
    sqlx::query_as::<_, ExecutionRow>(
        "SELECT id, session_id, status, language, created_at, duration_ms FROM execution.history WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Create a new execution record.
pub async fn create_execution(
    pool: &PgPool,
    id: &str,
    session_id: Option<&str>,
    language: Option<&str>,
) -> Result<ExecutionRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ExecutionRow>(
        "INSERT INTO execution.history (id, session_id, status, language, created_at)
         VALUES ($1, $2, 'running', $3, $4)
         RETURNING *",
    )
    .bind(id)
    .bind(session_id)
    .bind(language)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Delete an execution by ID.
pub async fn delete_execution(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM execution.history WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// List execution sessions.
pub async fn list_sessions(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ExecutionSessionRow>, sqlx::Error> {
    sqlx::query_as::<_, ExecutionSessionRow>(
        "SELECT id, status, created_at FROM execution.sessions ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

/// Get a single session by ID.
pub async fn get_session(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ExecutionSessionRow>, sqlx::Error> {
    sqlx::query_as::<_, ExecutionSessionRow>(
        "SELECT id, status, created_at FROM execution.sessions WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Delete a session by ID.
pub async fn delete_session(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM execution.sessions WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
