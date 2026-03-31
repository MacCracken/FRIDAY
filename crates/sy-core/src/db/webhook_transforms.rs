//! Webhook transform storage — payload transformations via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WebhookTransformRow {
    pub id: String,
    pub name: String,
    pub source_event: String,
    pub template: serde_json::Value,
    pub description: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_transforms(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<WebhookTransformRow>, sqlx::Error> {
    sqlx::query_as::<_, WebhookTransformRow>(
        "SELECT * FROM public.webhook_transforms ORDER BY name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_transform(
    pool: &PgPool,
    id: &str,
) -> Result<Option<WebhookTransformRow>, sqlx::Error> {
    sqlx::query_as::<_, WebhookTransformRow>(
        "SELECT * FROM public.webhook_transforms WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_transform(
    pool: &PgPool,
    id: &str,
    name: &str,
    source_event: &str,
    template: &serde_json::Value,
    description: Option<&str>,
) -> Result<WebhookTransformRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, WebhookTransformRow>(
        "INSERT INTO public.webhook_transforms (id, name, source_event, template, description, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, $6)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(source_event)
    .bind(template)
    .bind(description)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn delete_transform(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM public.webhook_transforms WHERE id = $1")
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
