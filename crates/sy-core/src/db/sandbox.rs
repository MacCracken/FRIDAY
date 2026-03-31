//! Sandbox storage — profiles, scans, and quarantine via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SandboxProfileRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub policy: serde_json::Value,
    pub enabled: Option<bool>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_profiles(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<SandboxProfileRow>, sqlx::Error> {
    sqlx::query_as::<_, SandboxProfileRow>(
        "SELECT * FROM sandbox.profiles ORDER BY name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SandboxScanRow {
    pub id: String,
    pub profile_id: Option<String>,
    pub status: String,
    pub target: Option<String>,
    pub findings: serde_json::Value,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub created_at: i64,
}

pub async fn list_scans(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<SandboxScanRow>, sqlx::Error> {
    sqlx::query_as::<_, SandboxScanRow>(
        "SELECT * FROM sandbox.scans ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn create_scan(
    pool: &PgPool,
    id: &str,
    profile_id: Option<&str>,
    target: Option<&str>,
) -> Result<SandboxScanRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, SandboxScanRow>(
        "INSERT INTO sandbox.scans (id, profile_id, status, target, findings, started_at, created_at) VALUES ($1, $2, 'running', $3, '{}', $4, $4) RETURNING *",
    )
    .bind(id).bind(profile_id).bind(target).bind(now)
    .fetch_one(pool).await
}

pub async fn get_scan(pool: &PgPool, id: &str) -> Result<Option<SandboxScanRow>, sqlx::Error> {
    sqlx::query_as::<_, SandboxScanRow>("SELECT * FROM sandbox.scans WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineRow {
    pub id: String,
    pub scan_id: Option<String>,
    pub item_type: String,
    pub item_name: String,
    pub reason: Option<String>,
    pub status: String,
    pub metadata: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_quarantine(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<QuarantineRow>, sqlx::Error> {
    sqlx::query_as::<_, QuarantineRow>(
        "SELECT * FROM sandbox.quarantine ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn approve_quarantine_item(
    pool: &PgPool,
    id: &str,
) -> Result<Option<QuarantineRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, QuarantineRow>(
        "UPDATE sandbox.quarantine SET status = 'approved', updated_at = $2 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(now)
    .fetch_optional(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
