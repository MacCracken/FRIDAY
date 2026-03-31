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
