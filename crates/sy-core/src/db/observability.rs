//! Observability storage — metrics and alerts via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ObservabilityMetricRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub value: f64,
    pub unit: Option<String>,
    pub labels: serde_json::Value,
    pub recorded_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ObservabilityAlertRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub severity: String,
    pub status: String,
    pub message: Option<String>,
    pub metadata: serde_json::Value,
    pub fired_at: i64,
    pub resolved_at: Option<i64>,
}

pub async fn list_metrics(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ObservabilityMetricRow>, sqlx::Error> {
    sqlx::query_as::<_, ObservabilityMetricRow>(
        "SELECT * FROM observability.metrics WHERE tenant_id = $1 ORDER BY recorded_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn list_alerts(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ObservabilityAlertRow>, sqlx::Error> {
    sqlx::query_as::<_, ObservabilityAlertRow>(
        "SELECT * FROM observability.alerts WHERE tenant_id = $1 ORDER BY fired_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
