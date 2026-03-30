//! Notification storage — user notifications via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRow {
    pub id: String,
    pub r#type: String,
    pub title: String,
    pub body: String,
    pub level: String,
    pub source: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub read_at: Option<i64>,
    pub created_at: i64,
}

pub async fn list_notifications(
    pool: &PgPool,
    unread_only: bool,
    limit: i64,
    offset: i64,
) -> Result<Vec<NotificationRow>, sqlx::Error> {
    if unread_only {
        sqlx::query_as::<_, NotificationRow>(
            "SELECT * FROM public.notifications WHERE read_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        )
        .bind(limit).bind(offset)
        .fetch_all(pool).await
    } else {
        sqlx::query_as::<_, NotificationRow>(
            "SELECT * FROM public.notifications ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    }
}

pub async fn mark_read(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let result = sqlx::query(
        "UPDATE public.notifications SET read_at = $1 WHERE id = $2 AND read_at IS NULL",
    )
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn mark_all_read(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let now = now_ms();
    let result = sqlx::query("UPDATE public.notifications SET read_at = $1 WHERE read_at IS NULL")
        .bind(now)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
