//! Auth storage — API keys and users CRUD via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

/// API key row from auth.api_keys table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyRow {
    pub id: String,
    pub name: String,
    pub key_hash: String,
    pub key_prefix: String,
    pub permissions: serde_json::Value,
    pub expires_at: Option<i64>,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub tenant_id: String,
}

/// User row from auth.users table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UserRow {
    pub id: String,
    pub username: String,
    pub role: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub tenant_id: String,
}

/// List all API keys.
pub async fn list_api_keys(pool: &PgPool, tenant_id: &str) -> Result<Vec<ApiKeyRow>, sqlx::Error> {
    sqlx::query_as::<_, ApiKeyRow>(
        "SELECT * FROM auth.api_keys WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

/// Create an API key.
#[allow(clippy::too_many_arguments)]
pub async fn create_api_key(
    pool: &PgPool,
    id: &str,
    name: &str,
    key_hash: &str,
    key_prefix: &str,
    permissions: &serde_json::Value,
    expires_at: Option<i64>,
    tenant_id: &str,
) -> Result<ApiKeyRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ApiKeyRow>(
        "INSERT INTO auth.api_keys (id, name, key_hash, key_prefix, permissions, expires_at, created_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(key_hash)
    .bind(key_prefix)
    .bind(permissions)
    .bind(expires_at)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Delete (revoke) an API key by ID.
pub async fn delete_api_key(pool: &PgPool, id: &str, tenant_id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM auth.api_keys WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// List all users.
pub async fn list_users(pool: &PgPool, tenant_id: &str) -> Result<Vec<UserRow>, sqlx::Error> {
    sqlx::query_as::<_, UserRow>(
        "SELECT * FROM auth.users WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

/// Create a user.
pub async fn create_user(
    pool: &PgPool,
    id: &str,
    username: &str,
    role: &str,
    tenant_id: &str,
) -> Result<UserRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, UserRow>(
        "INSERT INTO auth.users (id, username, role, enabled, created_at, updated_at, tenant_id)
         VALUES ($1, $2, $3, true, $4, $4, $5)
         RETURNING *",
    )
    .bind(id)
    .bind(username)
    .bind(role)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Update a user's role.
pub async fn update_user_role(
    pool: &PgPool,
    id: &str,
    role: &str,
    tenant_id: &str,
) -> Result<Option<UserRow>, sqlx::Error> {
    sqlx::query_as::<_, UserRow>(
        "UPDATE auth.users SET role = $1, updated_at = $2 WHERE id = $3 AND tenant_id = $4 RETURNING *",
    )
    .bind(role)
    .bind(now_ms())
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
