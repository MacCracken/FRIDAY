//! Alert storage — alert rules via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AlertRuleRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub metric_path: String,
    pub operator: String,
    pub threshold: f32,
    pub channels: serde_json::Value,
    pub enabled: bool,
    pub cooldown_seconds: i32,
    pub last_fired_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_rules(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<(Vec<AlertRuleRow>, i64), sqlx::Error> {
    let rules = sqlx::query_as::<_, AlertRuleRow>(
        "SELECT * FROM telemetry.alert_rules ORDER BY name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    let (total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM telemetry.alert_rules")
        .fetch_one(pool)
        .await?;

    Ok((rules, total))
}

pub async fn get_rule(pool: &PgPool, id: &str) -> Result<Option<AlertRuleRow>, sqlx::Error> {
    sqlx::query_as::<_, AlertRuleRow>("SELECT * FROM telemetry.alert_rules WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}
