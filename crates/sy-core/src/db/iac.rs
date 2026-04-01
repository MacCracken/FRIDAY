//! IAC storage — templates, deployments via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IacTemplateRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub kind: String,
    pub content: String,
    pub control_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IacDeploymentRow {
    pub id: String,
    pub tenant_id: String,
    pub template_id: String,
    pub status: String,
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

// ── Templates ────────────────────────────────────────────────

pub async fn list_templates(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<IacTemplateRow>, sqlx::Error> {
    sqlx::query_as::<_, IacTemplateRow>(
        "SELECT * FROM iac.templates WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_template(pool: &PgPool, id: &str) -> Result<Option<IacTemplateRow>, sqlx::Error> {
    sqlx::query_as::<_, IacTemplateRow>("SELECT * FROM iac.templates WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn list_templates_for_control(
    pool: &PgPool,
    tenant_id: &str,
    control_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<IacTemplateRow>, sqlx::Error> {
    sqlx::query_as::<_, IacTemplateRow>(
        "SELECT * FROM iac.templates WHERE tenant_id = $1 AND control_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4",
    )
    .bind(tenant_id)
    .bind(control_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn delete_template(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM iac.templates WHERE id = $1")
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
) -> Result<Vec<IacDeploymentRow>, sqlx::Error> {
    sqlx::query_as::<_, IacDeploymentRow>(
        "SELECT * FROM iac.deployments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_deployment(
    pool: &PgPool,
    id: &str,
) -> Result<Option<IacDeploymentRow>, sqlx::Error> {
    sqlx::query_as::<_, IacDeploymentRow>("SELECT * FROM iac.deployments WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_deployment(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    template_id: &str,
    config: &serde_json::Value,
) -> Result<IacDeploymentRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, IacDeploymentRow>(
        "INSERT INTO iac.deployments (id, tenant_id, template_id, status, config, created_at, updated_at)
         VALUES ($1, $2, $3, 'pending', $4, $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(template_id)
    .bind(config)
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
