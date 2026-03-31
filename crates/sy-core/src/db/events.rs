//! Events storage — subscriptions and deliveries via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EventSubscriptionRow {
    pub id: String,
    pub name: String,
    pub event_type: String,
    pub target_url: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EventDeliveryRow {
    pub id: String,
    pub subscription_id: String,
    pub event_type: String,
    pub status: String,
    pub response_code: Option<i32>,
    pub delivered_at: i64,
}

pub async fn list_subscriptions(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<EventSubscriptionRow>, sqlx::Error> {
    sqlx::query_as::<_, EventSubscriptionRow>(
        "SELECT * FROM events.subscriptions ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_subscription(
    pool: &PgPool,
    id: &str,
) -> Result<Option<EventSubscriptionRow>, sqlx::Error> {
    sqlx::query_as::<_, EventSubscriptionRow>("SELECT * FROM events.subscriptions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn list_deliveries(
    pool: &PgPool,
    subscription_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<EventDeliveryRow>, sqlx::Error> {
    sqlx::query_as::<_, EventDeliveryRow>(
        "SELECT * FROM events.deliveries WHERE subscription_id = $1 ORDER BY delivered_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(subscription_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}
