//! Provider accounts storage — AI provider account management via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccountRow {
    pub id: String,
    pub tenant_id: String,
    pub provider: String,
    pub name: String,
    pub status: String,
    pub config: serde_json::Value,
    pub usage_total: Option<f64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_accounts(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ProviderAccountRow>, sqlx::Error> {
    sqlx::query_as::<_, ProviderAccountRow>(
        "SELECT * FROM provider_accounts.accounts WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_account(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ProviderAccountRow>, sqlx::Error> {
    sqlx::query_as::<_, ProviderAccountRow>(
        "SELECT * FROM provider_accounts.accounts WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_account(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    provider: &str,
    name: &str,
    config: &serde_json::Value,
) -> Result<ProviderAccountRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ProviderAccountRow>(
        "INSERT INTO provider_accounts.accounts (id, tenant_id, provider, name, status, config, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $6, $6) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(provider)
    .bind(name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn update_account(
    pool: &PgPool,
    id: &str,
    name: Option<&str>,
    config: Option<&serde_json::Value>,
    status: Option<&str>,
) -> Result<Option<ProviderAccountRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ProviderAccountRow>(
        "UPDATE provider_accounts.accounts SET
            name = COALESCE($2, name),
            config = COALESCE($3, config),
            status = COALESCE($4, status),
            updated_at = $5
         WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(config)
    .bind(status)
    .bind(now)
    .fetch_optional(pool)
    .await
}

pub async fn delete_account(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM provider_accounts.accounts WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn get_usage(pool: &PgPool, id: &str) -> Result<Option<ProviderAccountRow>, sqlx::Error> {
    sqlx::query_as::<_, ProviderAccountRow>(
        "SELECT * FROM provider_accounts.accounts WHERE id = $1",
    )
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
