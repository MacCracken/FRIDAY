//! Desktop storage — sessions via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSessionRow {
    pub id: String,
    pub tenant_id: String,
    pub name: Option<String>,
    pub status: String,
    pub resolution: Option<String>,
    pub metadata: serde_json::Value,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub created_at: i64,
}

pub async fn list_sessions(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<DesktopSessionRow>, sqlx::Error> {
    sqlx::query_as::<_, DesktopSessionRow>(
        "SELECT * FROM desktop.sessions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_session(
    pool: &PgPool,
    id: &str,
) -> Result<Option<DesktopSessionRow>, sqlx::Error> {
    sqlx::query_as::<_, DesktopSessionRow>("SELECT * FROM desktop.sessions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_session(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: Option<&str>,
    resolution: Option<&str>,
) -> Result<DesktopSessionRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, DesktopSessionRow>(
        "INSERT INTO desktop.sessions (id, tenant_id, name, status, resolution, metadata, started_at, created_at)
         VALUES ($1, $2, $3, 'active', $4, '{}', $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(resolution)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn delete_session(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let result = sqlx::query(
        "UPDATE desktop.sessions SET status = 'ended', ended_at = $2 WHERE id = $1 AND status = 'active'",
    )
    .bind(id)
    .bind(now)
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
