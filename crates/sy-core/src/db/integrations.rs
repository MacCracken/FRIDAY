//! Integration storage — connected services via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationRow {
    pub id: String,
    pub platform: String,
    pub display_name: String,
    pub enabled: bool,
    pub status: String,
    pub config: serde_json::Value,
    pub connected_at: Option<i64>,
    pub last_message_at: Option<i64>,
    pub message_count: i32,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_integrations(pool: &PgPool) -> Result<Vec<IntegrationRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationRow>(
        "SELECT * FROM integration.integrations ORDER BY display_name ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_integration(
    pool: &PgPool,
    id: &str,
) -> Result<Option<IntegrationRow>, sqlx::Error> {
    sqlx::query_as::<_, IntegrationRow>("SELECT * FROM integration.integrations WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn update_integration_status(
    pool: &PgPool,
    id: &str,
    enabled: bool,
    status: &str,
) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let result = sqlx::query("UPDATE integration.integrations SET enabled = $1, status = $2, updated_at = $3 WHERE id = $4")
        .bind(enabled).bind(status).bind(now).bind(id)
        .execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

#[allow(clippy::too_many_arguments)]
pub async fn create_integration(
    pool: &PgPool,
    id: &str,
    platform: &str,
    display_name: &str,
    config: &serde_json::Value,
) -> Result<IntegrationRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, IntegrationRow>(
        "INSERT INTO integration.integrations (id, platform, display_name, config, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *",
    )
    .bind(id).bind(platform).bind(display_name).bind(config).bind(now)
    .fetch_one(pool).await
}

pub async fn delete_integration(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM integration.integrations WHERE id = $1")
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
