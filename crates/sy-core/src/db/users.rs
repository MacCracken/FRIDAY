//! Users storage — user profiles and notification preferences via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileRow {
    pub id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPrefRow {
    pub user_id: String,
    pub key: String,
    pub enabled: bool,
    pub channel: Option<String>,
}

pub async fn list_users(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<UserProfileRow>, sqlx::Error> {
    sqlx::query_as::<_, UserProfileRow>(
        "SELECT * FROM users.profiles ORDER BY display_name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_user(pool: &PgPool, id: &str) -> Result<Option<UserProfileRow>, sqlx::Error> {
    sqlx::query_as::<_, UserProfileRow>("SELECT * FROM users.profiles WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn get_notification_prefs(
    pool: &PgPool,
    user_id: &str,
) -> Result<Vec<NotificationPrefRow>, sqlx::Error> {
    sqlx::query_as::<_, NotificationPrefRow>(
        "SELECT user_id, key, enabled, channel FROM users.notification_prefs WHERE user_id = $1 ORDER BY key ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn update_notification_pref(
    pool: &PgPool,
    user_id: &str,
    key: &str,
    enabled: bool,
    channel: Option<&str>,
) -> Result<NotificationPrefRow, sqlx::Error> {
    sqlx::query_as::<_, NotificationPrefRow>(
        "INSERT INTO users.notification_prefs (user_id, key, enabled, channel)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, key) DO UPDATE SET enabled = $3, channel = $4
         RETURNING *",
    )
    .bind(user_id)
    .bind(key)
    .bind(enabled)
    .bind(channel)
    .fetch_one(pool)
    .await
}
