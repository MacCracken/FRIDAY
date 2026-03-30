//! Audit storage — tamper-evident log entries via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntryRow {
    pub id: String,
    pub correlation_id: Option<String>,
    pub event: String,
    pub level: String,
    pub message: String,
    pub user_id: Option<String>,
    pub task_id: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub timestamp: i64,
    pub integrity_version: String,
    pub integrity_signature: String,
    pub integrity_previous_hash: String,
    pub tenant_id: String,
}

pub async fn list_entries(
    pool: &PgPool,
    tenant_id: &str,
    event: Option<&str>,
    level: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<AuditEntryRow>, sqlx::Error> {
    if let Some(ev) = event {
        sqlx::query_as::<_, AuditEntryRow>(
            "SELECT id, correlation_id, event, level, message, user_id, task_id, metadata, \"timestamp\", integrity_version, integrity_signature, integrity_previous_hash, tenant_id FROM audit.entries WHERE tenant_id = $1 AND event = $2 ORDER BY \"timestamp\" DESC LIMIT $3 OFFSET $4",
        )
        .bind(tenant_id).bind(ev).bind(limit).bind(offset)
        .fetch_all(pool).await
    } else if let Some(lv) = level {
        sqlx::query_as::<_, AuditEntryRow>(
            "SELECT id, correlation_id, event, level, message, user_id, task_id, metadata, \"timestamp\", integrity_version, integrity_signature, integrity_previous_hash, tenant_id FROM audit.entries WHERE tenant_id = $1 AND level = $2 ORDER BY \"timestamp\" DESC LIMIT $3 OFFSET $4",
        )
        .bind(tenant_id).bind(lv).bind(limit).bind(offset)
        .fetch_all(pool).await
    } else {
        sqlx::query_as::<_, AuditEntryRow>(
            "SELECT id, correlation_id, event, level, message, user_id, task_id, metadata, \"timestamp\", integrity_version, integrity_signature, integrity_previous_hash, tenant_id FROM audit.entries WHERE tenant_id = $1 ORDER BY \"timestamp\" DESC LIMIT $2 OFFSET $3",
        )
        .bind(tenant_id).bind(limit).bind(offset)
        .fetch_all(pool).await
    }
}

pub async fn get_entry(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<Option<AuditEntryRow>, sqlx::Error> {
    sqlx::query_as::<_, AuditEntryRow>(
        "SELECT id, correlation_id, event, level, message, user_id, task_id, metadata, \"timestamp\", integrity_version, integrity_signature, integrity_previous_hash, tenant_id FROM audit.entries WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id).bind(tenant_id)
    .fetch_optional(pool).await
}

pub async fn count_entries(pool: &PgPool, tenant_id: &str) -> Result<i64, sqlx::Error> {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM audit.entries WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(pool)
            .await?;
    Ok(count)
}

/// Streaming export query — returns rows for memory-efficient export.
/// Filters: from/to timestamps, userId. Capped at `limit`.
pub async fn export_entries(
    pool: &PgPool,
    tenant_id: &str,
    from: Option<i64>,
    to: Option<i64>,
    user_id: Option<&str>,
    limit: i64,
) -> Result<Vec<AuditEntryRow>, sqlx::Error> {
    let from_ts = from.unwrap_or(0);
    let to_ts = to.unwrap_or(i64::MAX);
    let uid = user_id.unwrap_or("");
    let has_user = user_id.is_some();
    let cap = limit.min(1_000_000);

    sqlx::query_as::<_, AuditEntryRow>(
        r#"SELECT id, correlation_id, event, level, message, user_id, task_id, metadata,
                  "timestamp", integrity_version, integrity_signature,
                  integrity_previous_hash, tenant_id
           FROM audit.entries
           WHERE tenant_id = $1
             AND "timestamp" >= $2
             AND "timestamp" <= $3
             AND ($4::bool = false OR user_id = $5)
           ORDER BY "timestamp" DESC
           LIMIT $6"#,
    )
    .bind(tenant_id)
    .bind(from_ts)
    .bind(to_ts)
    .bind(has_user)
    .bind(uid)
    .bind(cap)
    .fetch_all(pool)
    .await
}
