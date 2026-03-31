//! Tenant storage.
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TenantRow {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub created_at: i64,
}

pub async fn list_tenants(pool: &PgPool) -> Result<Vec<TenantRow>, sqlx::Error> {
    sqlx::query_as::<_, TenantRow>(
        "SELECT id, name, enabled, created_at FROM auth.tenants ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await
}

/// Get a tenant by ID.
pub async fn get_tenant(pool: &PgPool, id: &str) -> Result<Option<TenantRow>, sqlx::Error> {
    sqlx::query_as::<_, TenantRow>(
        "SELECT id, name, enabled, created_at FROM auth.tenants WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Create a new tenant.
pub async fn create_tenant(pool: &PgPool, id: &str, name: &str) -> Result<TenantRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, TenantRow>(
        "INSERT INTO auth.tenants (id, name, enabled, created_at)
         VALUES ($1, $2, true, $3)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Update a tenant's name and enabled flag.
pub async fn update_tenant(
    pool: &PgPool,
    id: &str,
    name: &str,
    enabled: bool,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE auth.tenants SET name = $1, enabled = $2 WHERE id = $3")
        .bind(name)
        .bind(enabled)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Delete a tenant by ID.
pub async fn delete_tenant(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM auth.tenants WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TenantQuotaRow {
    pub tenant_id: String,
    pub resource: String,
    pub limit_value: i64,
    pub current_value: i64,
}

pub async fn get_tenant_quotas(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Vec<TenantQuotaRow>, sqlx::Error> {
    sqlx::query_as::<_, TenantQuotaRow>(
        "SELECT tenant_id, resource, limit_value, current_value FROM auth.tenant_quotas WHERE tenant_id = $1 ORDER BY resource ASC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TenantUsageRow {
    pub tenant_id: String,
    pub tokens: i64,
    pub requests: i64,
    pub updated_at: i64,
}

pub async fn get_tenant_usage(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Option<TenantUsageRow>, sqlx::Error> {
    sqlx::query_as::<_, TenantUsageRow>(
        "SELECT tenant_id, tokens, requests, updated_at FROM auth.tenant_usage WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn reset_tenant_usage(pool: &PgPool, tenant_id: &str) -> Result<(), sqlx::Error> {
    let now = now_ms();
    sqlx::query(
        "UPDATE auth.tenant_usage SET tokens = 0, requests = 0, updated_at = $2 WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TenantTokenUsageRow {
    pub tenant_id: String,
    pub model: String,
    pub tokens: i64,
    pub period: String,
}

pub async fn get_tenant_token_usage(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Vec<TenantTokenUsageRow>, sqlx::Error> {
    sqlx::query_as::<_, TenantTokenUsageRow>(
        "SELECT tenant_id, model, tokens, period FROM auth.tenant_token_usage WHERE tenant_id = $1 ORDER BY period DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
