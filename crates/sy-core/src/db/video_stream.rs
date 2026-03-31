//! Video stream storage — sessions via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct VideoStreamSessionRow {
    pub id: String,
    pub source: String,
    pub status: String,
    pub resolution: Option<String>,
    pub bitrate: Option<i64>,
    pub created_at: i64,
    pub stopped_at: Option<i64>,
}

pub async fn list_sessions(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<VideoStreamSessionRow>, sqlx::Error> {
    sqlx::query_as::<_, VideoStreamSessionRow>(
        "SELECT * FROM video_stream.sessions ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_session(
    pool: &PgPool,
    id: &str,
) -> Result<Option<VideoStreamSessionRow>, sqlx::Error> {
    sqlx::query_as::<_, VideoStreamSessionRow>("SELECT * FROM video_stream.sessions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_session(
    pool: &PgPool,
    id: &str,
    source: &str,
    resolution: Option<&str>,
    bitrate: Option<i64>,
) -> Result<VideoStreamSessionRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, VideoStreamSessionRow>(
        "INSERT INTO video_stream.sessions (id, source, status, resolution, bitrate, created_at)
         VALUES ($1, $2, 'active', $3, $4, $5)
         RETURNING *",
    )
    .bind(id)
    .bind(source)
    .bind(resolution)
    .bind(bitrate)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn stop_session(
    pool: &PgPool,
    id: &str,
) -> Result<Option<VideoStreamSessionRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, VideoStreamSessionRow>(
        "UPDATE video_stream.sessions SET status = 'stopped', stopped_at = $1 WHERE id = $2 RETURNING *",
    )
    .bind(now)
    .bind(id)
    .fetch_optional(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
