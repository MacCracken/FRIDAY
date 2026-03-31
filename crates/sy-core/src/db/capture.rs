//! Capture storage — consent records via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CaptureConsentRow {
    pub id: String,
    pub subject: String,
    pub purpose: String,
    pub status: String,
    pub data_types: serde_json::Value,
    pub expires_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_consent(
    pool: &PgPool,
    id: &str,
    subject: &str,
    purpose: &str,
    data_types: &serde_json::Value,
    expires_at: Option<i64>,
) -> Result<CaptureConsentRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, CaptureConsentRow>(
        "INSERT INTO capture.consents (id, subject, purpose, status, data_types, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6, $6)
         RETURNING *",
    )
    .bind(id)
    .bind(subject)
    .bind(purpose)
    .bind(data_types)
    .bind(expires_at)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_pending(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<CaptureConsentRow>, sqlx::Error> {
    sqlx::query_as::<_, CaptureConsentRow>(
        "SELECT * FROM capture.consents WHERE status = 'pending' ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_consent(
    pool: &PgPool,
    id: &str,
) -> Result<Option<CaptureConsentRow>, sqlx::Error> {
    sqlx::query_as::<_, CaptureConsentRow>("SELECT * FROM capture.consents WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn update_consent_status(
    pool: &PgPool,
    id: &str,
    status: &str,
) -> Result<Option<CaptureConsentRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, CaptureConsentRow>(
        "UPDATE capture.consents SET status = $1, updated_at = $2 WHERE id = $3 RETURNING *",
    )
    .bind(status)
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
