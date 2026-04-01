//! Policy-as-code storage — bundles, deployments via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PolicyBundleRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDeploymentRow {
    pub id: String,
    pub tenant_id: String,
    pub bundle_id: String,
    pub bundle_name: String,
    pub status: String,
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

// ── Bundles ──────────────────────────────────────────────────

pub async fn list_bundles(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<PolicyBundleRow>, sqlx::Error> {
    sqlx::query_as::<_, PolicyBundleRow>(
        "SELECT * FROM policy_as_code.bundles WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_bundle(pool: &PgPool, id: &str) -> Result<Option<PolicyBundleRow>, sqlx::Error> {
    sqlx::query_as::<_, PolicyBundleRow>("SELECT * FROM policy_as_code.bundles WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn get_bundle_by_name(
    pool: &PgPool,
    tenant_id: &str,
    name: &str,
) -> Result<Option<PolicyBundleRow>, sqlx::Error> {
    sqlx::query_as::<_, PolicyBundleRow>(
        "SELECT * FROM policy_as_code.bundles WHERE tenant_id = $1 AND name = $2",
    )
    .bind(tenant_id)
    .bind(name)
    .fetch_optional(pool)
    .await
}

pub async fn delete_bundle(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM policy_as_code.bundles WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Deployments ──────────────────────────────────────────────

pub async fn list_deployments(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<PolicyDeploymentRow>, sqlx::Error> {
    sqlx::query_as::<_, PolicyDeploymentRow>(
        "SELECT * FROM policy_as_code.deployments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn create_deployment(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    bundle_id: &str,
    bundle_name: &str,
    config: &serde_json::Value,
) -> Result<PolicyDeploymentRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, PolicyDeploymentRow>(
        "INSERT INTO policy_as_code.deployments (id, tenant_id, bundle_id, bundle_name, status, config, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $6) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(bundle_id)
    .bind(bundle_name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn rollback_latest_deployment(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Option<PolicyDeploymentRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, PolicyDeploymentRow>(
        "UPDATE policy_as_code.deployments SET status = 'rolled_back', updated_at = $2
         WHERE tenant_id = $1 AND status = 'deployed'
         AND created_at = (SELECT MAX(created_at) FROM policy_as_code.deployments WHERE tenant_id = $1 AND status = 'deployed')
         RETURNING *",
    )
    .bind(tenant_id)
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
