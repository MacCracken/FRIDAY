//! Webhook timeline storage — inbound/outbound event log via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WebhookTimelineRow {
    pub id: String,
    pub source: String,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub status: String,
    pub error_message: Option<String>,
    pub replayed: bool,
    pub created_at: i64,
}

pub async fn list_events(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<WebhookTimelineRow>, sqlx::Error> {
    sqlx::query_as::<_, WebhookTimelineRow>(
        "SELECT * FROM integration.webhook_timeline ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_event(pool: &PgPool, id: &str) -> Result<Option<WebhookTimelineRow>, sqlx::Error> {
    sqlx::query_as::<_, WebhookTimelineRow>(
        "SELECT * FROM integration.webhook_timeline WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn mark_replayed(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result =
        sqlx::query("UPDATE integration.webhook_timeline SET replayed = true WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
    Ok(result.rows_affected() > 0)
}
