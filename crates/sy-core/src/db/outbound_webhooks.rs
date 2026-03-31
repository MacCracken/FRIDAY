//! Outbound webhook storage — webhook configurations via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OutboundWebhookRow {
    pub id: String,
    pub url: String,
    pub events: serde_json::Value,
    pub secret: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
    pub last_triggered_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_webhooks(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<OutboundWebhookRow>, sqlx::Error> {
    sqlx::query_as::<_, OutboundWebhookRow>(
        "SELECT * FROM public.outbound_webhooks ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_webhook(
    pool: &PgPool,
    id: &str,
) -> Result<Option<OutboundWebhookRow>, sqlx::Error> {
    sqlx::query_as::<_, OutboundWebhookRow>("SELECT * FROM public.outbound_webhooks WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_webhook(
    pool: &PgPool,
    id: &str,
    url: &str,
    events: &[String],
    secret: Option<&str>,
    description: Option<&str>,
) -> Result<OutboundWebhookRow, sqlx::Error> {
    let now = now_ms();
    let events_json = serde_json::to_value(events).unwrap_or_default();
    sqlx::query_as::<_, OutboundWebhookRow>(
        "INSERT INTO public.outbound_webhooks (id, url, events, secret, description, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, $6)
         RETURNING *",
    )
    .bind(id)
    .bind(url)
    .bind(events_json)
    .bind(secret)
    .bind(description)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn delete_webhook(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM public.outbound_webhooks WHERE id = $1")
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
