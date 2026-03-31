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

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
