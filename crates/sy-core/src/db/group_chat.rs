//! Group chat storage — cross-platform channels and messages via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GroupChatChannelRow {
    pub id: String,
    pub platform: String,
    pub name: String,
    pub external_id: Option<String>,
    pub member_count: i32,
    pub last_message_at: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GroupChatMessageRow {
    pub id: String,
    pub channel_id: String,
    pub platform: String,
    pub sender_name: Option<String>,
    pub content: String,
    pub external_id: Option<String>,
    pub created_at: i64,
}

pub async fn list_channels(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<GroupChatChannelRow>, sqlx::Error> {
    sqlx::query_as::<_, GroupChatChannelRow>(
        "SELECT * FROM group_chat.channels ORDER BY last_message_at DESC NULLS LAST LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn list_messages(
    pool: &PgPool,
    channel_id: &str,
    platform: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<GroupChatMessageRow>, sqlx::Error> {
    sqlx::query_as::<_, GroupChatMessageRow>(
        "SELECT * FROM group_chat.messages WHERE channel_id = $1 AND platform = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4",
    )
    .bind(channel_id)
    .bind(platform)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}
