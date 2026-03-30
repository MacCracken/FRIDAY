//! Chat storage — conversations and messages CRUD via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRow {
    pub id: String,
    pub title: String,
    pub personality_id: Option<String>,
    pub message_count: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub tenant_id: String,
    pub parent_conversation_id: Option<String>,
    pub fork_message_index: Option<i32>,
    pub branch_label: Option<String>,
    pub strategy_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub tokens_used: Option<i32>,
    pub attachments_json: serde_json::Value,
    pub brain_context_json: Option<serde_json::Value>,
    pub created_at: i64,
    pub thinking_content: Option<String>,
    pub tool_calls_json: Option<serde_json::Value>,
    pub injection_score: Option<f32>,
    pub citations_json: Option<serde_json::Value>,
    pub grounding_score: Option<f32>,
}

pub async fn create_conversation(
    pool: &PgPool,
    id: &str,
    title: &str,
    personality_id: Option<&str>,
    tenant_id: &str,
) -> Result<ConversationRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ConversationRow>(
        "INSERT INTO chat.conversations (id, title, personality_id, created_at, updated_at, tenant_id) VALUES ($1, $2, $3, $4, $4, $5) RETURNING *",
    )
    .bind(id).bind(title).bind(personality_id).bind(now).bind(tenant_id)
    .fetch_one(pool).await
}

pub async fn list_conversations(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ConversationRow>, sqlx::Error> {
    sqlx::query_as::<_, ConversationRow>(
        "SELECT * FROM chat.conversations WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_conversation(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<Option<ConversationRow>, sqlx::Error> {
    sqlx::query_as::<_, ConversationRow>(
        "SELECT * FROM chat.conversations WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_conversation(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    // Delete messages first, then conversation
    sqlx::query("DELETE FROM chat.messages WHERE conversation_id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    let result = sqlx::query("DELETE FROM chat.conversations WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
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

pub async fn list_messages(
    pool: &PgPool,
    conversation_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<MessageRow>, sqlx::Error> {
    sqlx::query_as::<_, MessageRow>(
        "SELECT * FROM chat.messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3",
    )
    .bind(conversation_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}
