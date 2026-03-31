//! Proactive automation storage.
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatLogRow {
    pub id: String,
    pub personality_id: Option<String>,
    pub trigger_type: String,
    pub created_at: i64,
}

pub async fn list_heartbeat_logs(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<HeartbeatLogRow>, sqlx::Error> {
    sqlx::query_as::<_, HeartbeatLogRow>("SELECT id, personality_id, trigger_type, created_at FROM proactive.heartbeat_log ORDER BY created_at DESC LIMIT $1")
        .bind(limit).fetch_all(pool).await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProactiveSuggestionRow {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub priority: Option<String>,
    pub status: String,
    pub source: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_suggestions(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ProactiveSuggestionRow>, sqlx::Error> {
    sqlx::query_as::<_, ProactiveSuggestionRow>(
        "SELECT * FROM proactive.suggestions ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn approve_suggestion(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ProactiveSuggestionRow>, sqlx::Error> {
    sqlx::query_as::<_, ProactiveSuggestionRow>(
        "UPDATE proactive.suggestions SET status = 'approved', updated_at = $2 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(now_ms())
    .fetch_optional(pool)
    .await
}

pub async fn dismiss_suggestion(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ProactiveSuggestionRow>, sqlx::Error> {
    sqlx::query_as::<_, ProactiveSuggestionRow>(
        "UPDATE proactive.suggestions SET status = 'dismissed', updated_at = $2 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(now_ms())
    .fetch_optional(pool)
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProactiveTriggerRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub trigger_type: String,
    pub condition: serde_json::Value,
    pub action: serde_json::Value,
    pub enabled: Option<bool>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_triggers(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ProactiveTriggerRow>, sqlx::Error> {
    sqlx::query_as::<_, ProactiveTriggerRow>(
        "SELECT * FROM proactive.triggers ORDER BY name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn create_trigger(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    trigger_type: &str,
    condition: &serde_json::Value,
    action: &serde_json::Value,
) -> Result<ProactiveTriggerRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ProactiveTriggerRow>(
        "INSERT INTO proactive.triggers (id, name, description, trigger_type, condition, action, enabled, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7) RETURNING *",
    )
    .bind(id).bind(name).bind(description).bind(trigger_type)
    .bind(condition).bind(action).bind(now)
    .fetch_one(pool).await
}

pub async fn get_trigger(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ProactiveTriggerRow>, sqlx::Error> {
    sqlx::query_as::<_, ProactiveTriggerRow>("SELECT * FROM proactive.triggers WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn delete_trigger(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM proactive.triggers WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProactivePatternRow {
    pub id: String,
    pub pattern_type: String,
    pub description: Option<String>,
    pub confidence: Option<f64>,
    pub occurrences: Option<i32>,
    pub metadata: serde_json::Value,
    pub learned_at: i64,
}

pub async fn list_patterns(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ProactivePatternRow>, sqlx::Error> {
    sqlx::query_as::<_, ProactivePatternRow>(
        "SELECT * FROM proactive.patterns ORDER BY learned_at DESC LIMIT $1 OFFSET $2",
    )
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
