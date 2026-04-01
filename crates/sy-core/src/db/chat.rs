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

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ChatFeedbackRow {
    pub id: String,
    pub message_id: String,
    pub rating: String,
    pub comment: Option<String>,
    pub created_at: i64,
}

pub async fn save_feedback(
    pool: &PgPool,
    message_id: &str,
    rating: &str,
    comment: Option<&str>,
) -> Result<ChatFeedbackRow, sqlx::Error> {
    let id = uuid::Uuid::now_v7().to_string();
    let now = now_ms();
    sqlx::query_as::<_, ChatFeedbackRow>(
        "INSERT INTO chat.feedback (id, message_id, rating, comment, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    )
    .bind(&id)
    .bind(message_id)
    .bind(rating)
    .bind(comment)
    .bind(now)
    .fetch_one(pool)
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ChatMemoryRow {
    pub id: String,
    pub message_id: String,
    pub label: Option<String>,
    pub created_at: i64,
}

pub async fn save_memory(
    pool: &PgPool,
    message_id: &str,
    label: Option<&str>,
) -> Result<ChatMemoryRow, sqlx::Error> {
    let id = uuid::Uuid::now_v7().to_string();
    let now = now_ms();
    sqlx::query_as::<_, ChatMemoryRow>(
        "INSERT INTO chat.memories (id, message_id, label, created_at) VALUES ($1, $2, $3, $4) RETURNING *",
    )
    .bind(&id)
    .bind(message_id)
    .bind(label)
    .bind(now)
    .fetch_one(pool)
    .await
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

/// Update the title of a conversation. Returns the updated row or None if not found.
pub async fn update_conversation_title(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    title: &str,
) -> Result<Option<ConversationRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ConversationRow>(
        "UPDATE chat.conversations SET title = $3, updated_at = $4 WHERE id = $1 AND tenant_id = $2 RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(title)
    .bind(now)
    .fetch_optional(pool)
    .await
}

/// Branch a conversation from a given message index. Copies the parent conversation row
/// (with updated id/timestamps) and records the fork origin. Messages are NOT copied
/// here — the caller may seed the branch separately.
pub async fn branch_conversation(
    pool: &PgPool,
    new_id: &str,
    parent_id: &str,
    fork_message_index: i32,
    title: &str,
    tenant_id: &str,
) -> Result<ConversationRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ConversationRow>(
        "INSERT INTO chat.conversations
             (id, title, personality_id, message_count, created_at, updated_at, tenant_id,
              parent_conversation_id, fork_message_index, branch_label, strategy_id)
         SELECT $1, $3, personality_id, 0, $4, $4, $5,
                $2, $6, NULL, strategy_id
         FROM chat.conversations
         WHERE id = $2 AND tenant_id = $5
         RETURNING *",
    )
    .bind(new_id)
    .bind(parent_id)
    .bind(title)
    .bind(now)
    .bind(tenant_id)
    .bind(fork_message_index)
    .fetch_one(pool)
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationExport {
    pub conversation: ConversationRow,
    pub messages: Vec<MessageRow>,
    pub format: String,
    pub exported_at: i64,
}

/// Fetch a conversation and all its messages for export.
pub async fn export_conversation(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    format: &str,
) -> Result<Option<ConversationExport>, sqlx::Error> {
    let Some(conversation) = get_conversation(pool, id, tenant_id).await? else {
        return Ok(None);
    };
    let messages = sqlx::query_as::<_, MessageRow>(
        "SELECT * FROM chat.messages WHERE conversation_id = $1 ORDER BY created_at ASC",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;
    Ok(Some(ConversationExport {
        conversation,
        messages,
        format: format.to_string(),
        exported_at: now_ms(),
    }))
}
