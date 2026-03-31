//! Browser storage — browser sessions via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionRow {
    pub id: String,
    pub url: Option<String>,
    pub status: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub page_title: Option<String>,
}

pub async fn list_sessions(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<BrowserSessionRow>, sqlx::Error> {
    sqlx::query_as::<_, BrowserSessionRow>(
        "SELECT * FROM browser.sessions ORDER BY started_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_session(
    pool: &PgPool,
    id: &str,
) -> Result<Option<BrowserSessionRow>, sqlx::Error> {
    sqlx::query_as::<_, BrowserSessionRow>("SELECT * FROM browser.sessions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn close_session(
    pool: &PgPool,
    id: &str,
) -> Result<Option<BrowserSessionRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, BrowserSessionRow>(
        "UPDATE browser.sessions SET status = 'closed', ended_at = $2 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(now)
    .fetch_optional(pool)
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BrowserConfigRow {
    pub key: String,
    pub value: serde_json::Value,
}

pub async fn get_config(pool: &PgPool) -> Result<Vec<BrowserConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, BrowserConfigRow>("SELECT key, value FROM browser.config ORDER BY key ASC")
        .fetch_all(pool)
        .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
