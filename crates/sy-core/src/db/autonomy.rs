//! Autonomy storage — audits via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AutonomyAuditRow {
    pub id: String,
    pub agent_id: String,
    pub status: String,
    pub items_json: serde_json::Value,
    pub findings: Option<String>,
    pub created_at: i64,
    pub finalized_at: Option<i64>,
}

pub async fn list_audits(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<AutonomyAuditRow>, sqlx::Error> {
    sqlx::query_as::<_, AutonomyAuditRow>(
        "SELECT * FROM autonomy.audits ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_audit(pool: &PgPool, id: &str) -> Result<Option<AutonomyAuditRow>, sqlx::Error> {
    sqlx::query_as::<_, AutonomyAuditRow>("SELECT * FROM autonomy.audits WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn finalize_audit(
    pool: &PgPool,
    id: &str,
) -> Result<Option<AutonomyAuditRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AutonomyAuditRow>(
        "UPDATE autonomy.audits SET status = 'finalized', finalized_at = $1 WHERE id = $2 RETURNING *",
    )
    .bind(now)
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn update_audit_item(
    pool: &PgPool,
    audit_id: &str,
    item_id: &str,
    status: &str,
    notes: Option<&str>,
) -> Result<bool, sqlx::Error> {
    // Update a specific item inside the items_json JSONB array.
    // This uses a jsonb_set approach — simplified for the stub.
    let result = sqlx::query(
        "UPDATE autonomy.audit_items SET status = $1, notes = $2 WHERE audit_id = $3 AND id = $4",
    )
    .bind(status)
    .bind(notes)
    .bind(audit_id)
    .bind(item_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn create_audit(
    pool: &PgPool,
    id: &str,
    agent_id: &str,
) -> Result<AutonomyAuditRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AutonomyAuditRow>(
        "INSERT INTO autonomy.audits (id, agent_id, status, items_json, created_at) VALUES ($1, $2, 'pending', '[]'::jsonb, $3) RETURNING *",
    )
    .bind(id).bind(agent_id).bind(now)
    .fetch_one(pool).await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
