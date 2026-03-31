//! Personalities storage — mood state and history via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityMoodRow {
    pub personality_id: String,
    pub mood: String,
    pub intensity: f64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MoodHistoryRow {
    pub id: String,
    pub personality_id: String,
    pub mood: String,
    pub intensity: f64,
    pub trigger_event: Option<String>,
    pub created_at: i64,
}

pub async fn get_mood(
    pool: &PgPool,
    personality_id: &str,
) -> Result<Option<PersonalityMoodRow>, sqlx::Error> {
    sqlx::query_as::<_, PersonalityMoodRow>(
        "SELECT personality_id, mood, intensity, updated_at FROM personalities.mood_state WHERE personality_id = $1",
    )
    .bind(personality_id)
    .fetch_optional(pool)
    .await
}

pub async fn record_mood_event(
    pool: &PgPool,
    personality_id: &str,
    event: &str,
    mood: &str,
    intensity: f64,
) -> Result<MoodHistoryRow, sqlx::Error> {
    let id = uuid::Uuid::now_v7().to_string();
    let now = now_ms();
    // Upsert current mood state
    sqlx::query(
        "INSERT INTO personalities.mood_state (personality_id, mood, intensity, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (personality_id) DO UPDATE SET mood = $2, intensity = $3, updated_at = $4",
    )
    .bind(personality_id)
    .bind(mood)
    .bind(intensity)
    .bind(now)
    .execute(pool)
    .await?;
    // Record history
    sqlx::query_as::<_, MoodHistoryRow>(
        "INSERT INTO personalities.mood_history (id, personality_id, mood, intensity, trigger_event, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    )
    .bind(&id)
    .bind(personality_id)
    .bind(mood)
    .bind(intensity)
    .bind(event)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_mood_history(
    pool: &PgPool,
    personality_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<MoodHistoryRow>, sqlx::Error> {
    sqlx::query_as::<_, MoodHistoryRow>(
        "SELECT * FROM personalities.mood_history WHERE personality_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(personality_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn reset_mood(
    pool: &PgPool,
    personality_id: &str,
) -> Result<Option<PersonalityMoodRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, PersonalityMoodRow>(
        "UPDATE personalities.mood_state SET mood = 'neutral', intensity = 0.5, updated_at = $2 WHERE personality_id = $1 RETURNING *",
    )
    .bind(personality_id)
    .bind(now)
    .fetch_optional(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
