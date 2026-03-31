//! Intent storage — patterns via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IntentPatternRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub pattern: String,
    pub category: Option<String>,
    pub priority: Option<i32>,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_patterns(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<IntentPatternRow>, sqlx::Error> {
    sqlx::query_as::<_, IntentPatternRow>(
        "SELECT * FROM intent.patterns WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_pattern(pool: &PgPool, id: &str) -> Result<Option<IntentPatternRow>, sqlx::Error> {
    sqlx::query_as::<_, IntentPatternRow>("SELECT * FROM intent.patterns WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_pattern(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    description: Option<&str>,
    pattern: &str,
    category: Option<&str>,
    priority: Option<i32>,
) -> Result<IntentPatternRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, IntentPatternRow>(
        "INSERT INTO intent.patterns (id, tenant_id, name, description, pattern, category, priority, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $8) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(description)
    .bind(pattern)
    .bind(category)
    .bind(priority)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn delete_pattern(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM intent.patterns WHERE id = $1")
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
