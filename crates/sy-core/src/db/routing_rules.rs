//! Routing rules storage — rule definitions via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RoutingRuleRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub condition: serde_json::Value,
    pub action: serde_json::Value,
    pub priority: i32,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_rules(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<RoutingRuleRow>, sqlx::Error> {
    sqlx::query_as::<_, RoutingRuleRow>(
        "SELECT * FROM routing.rules ORDER BY priority ASC, created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_rule(pool: &PgPool, id: &str) -> Result<Option<RoutingRuleRow>, sqlx::Error> {
    sqlx::query_as::<_, RoutingRuleRow>("SELECT * FROM routing.rules WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_rule(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    condition: &serde_json::Value,
    action: &serde_json::Value,
    priority: i32,
) -> Result<RoutingRuleRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, RoutingRuleRow>(
        "INSERT INTO routing.rules (id, name, description, condition, action, priority, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(condition)
    .bind(action)
    .bind(priority)
    .bind(now)
    .fetch_one(pool)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn update_rule(
    pool: &PgPool,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    condition: Option<&serde_json::Value>,
    action: Option<&serde_json::Value>,
    priority: Option<i32>,
    enabled: Option<bool>,
) -> Result<Option<RoutingRuleRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, RoutingRuleRow>(
        "UPDATE routing.rules
         SET name        = COALESCE($2, name),
             description = COALESCE($3, description),
             condition   = COALESCE($4, condition),
             action      = COALESCE($5, action),
             priority    = COALESCE($6, priority),
             enabled     = COALESCE($7, enabled),
             updated_at  = $8
         WHERE id = $1
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(condition)
    .bind(action)
    .bind(priority)
    .bind(enabled)
    .bind(now)
    .fetch_optional(pool)
    .await
}

pub async fn delete_rule(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM routing.rules WHERE id = $1")
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
