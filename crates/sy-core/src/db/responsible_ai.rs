//! Responsible AI storage — policies and audits via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiPolicyRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub rules: serde_json::Value,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiAuditRow {
    pub id: String,
    pub tenant_id: String,
    pub policy_id: Option<String>,
    pub action: String,
    pub result: String,
    pub details: serde_json::Value,
    pub created_at: i64,
}

pub async fn list_policies(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<AiPolicyRow>, sqlx::Error> {
    sqlx::query_as::<_, AiPolicyRow>(
        "SELECT * FROM responsible_ai.policies WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_policy(pool: &PgPool, id: &str) -> Result<Option<AiPolicyRow>, sqlx::Error> {
    sqlx::query_as::<_, AiPolicyRow>("SELECT * FROM responsible_ai.policies WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_policy(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    description: Option<&str>,
    category: &str,
    rules: &serde_json::Value,
) -> Result<AiPolicyRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AiPolicyRow>(
        "INSERT INTO responsible_ai.policies (id, tenant_id, name, description, category, rules, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(description)
    .bind(category)
    .bind(rules)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_audits(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<AiAuditRow>, sqlx::Error> {
    sqlx::query_as::<_, AiAuditRow>(
        "SELECT * FROM responsible_ai.audits WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn create_audit(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    policy_id: Option<&str>,
    action: &str,
    result: &str,
    details: &serde_json::Value,
) -> Result<AiAuditRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AiAuditRow>(
        "INSERT INTO responsible_ai.audits (id, tenant_id, policy_id, action, result, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(policy_id)
    .bind(action)
    .bind(result)
    .bind(details)
    .bind(now)
    .fetch_one(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
