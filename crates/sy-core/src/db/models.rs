//! Model configuration storage — active model info and defaults via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigRow {
    pub id: String,
    pub tenant_id: String,
    /// e.g. "ollama", "openai", "anthropic"
    pub provider: String,
    pub model_name: String,
    pub is_default: bool,
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Fetch the current active model config for a tenant (most recently updated non-default row).
/// Falls back to the default row if no active override exists.
pub async fn get_model_info(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Option<ModelConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, ModelConfigRow>(
        "SELECT * FROM model_config.configs WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Update (or upsert) the model config for a tenant. Creates a new row if none exists.
pub async fn upsert_model_info(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    provider: &str,
    model_name: &str,
    config: &serde_json::Value,
) -> Result<ModelConfigRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ModelConfigRow>(
        "INSERT INTO model_config.configs (id, tenant_id, provider, model_name, is_default, config, created_at, updated_at)
         VALUES ($1, $2, $3, $4, false, $5, $6, $6)
         ON CONFLICT (id) DO UPDATE SET
             provider = EXCLUDED.provider,
             model_name = EXCLUDED.model_name,
             config = EXCLUDED.config,
             updated_at = EXCLUDED.updated_at
         RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(provider)
    .bind(model_name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Get the default model for a tenant.
pub async fn get_default_model(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Option<ModelConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, ModelConfigRow>(
        "SELECT * FROM model_config.configs WHERE tenant_id = $1 AND is_default = true ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Set a model config row as the default for a tenant (clears previous default first).
pub async fn set_default_model(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    provider: &str,
    model_name: &str,
    config: &serde_json::Value,
) -> Result<ModelConfigRow, sqlx::Error> {
    let now = now_ms();
    // Clear existing defaults for this tenant
    sqlx::query(
        "UPDATE model_config.configs SET is_default = false WHERE tenant_id = $1 AND is_default = true",
    )
    .bind(tenant_id)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, ModelConfigRow>(
        "INSERT INTO model_config.configs (id, tenant_id, provider, model_name, is_default, config, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, $5, $6, $6)
         ON CONFLICT (id) DO UPDATE SET
             provider = EXCLUDED.provider,
             model_name = EXCLUDED.model_name,
             is_default = true,
             config = EXCLUDED.config,
             updated_at = EXCLUDED.updated_at
         RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(provider)
    .bind(model_name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Clear the default model for a tenant (sets all is_default = false).
pub async fn clear_default_model(pool: &PgPool, tenant_id: &str) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE model_config.configs SET is_default = false WHERE tenant_id = $1 AND is_default = true",
    )
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}
