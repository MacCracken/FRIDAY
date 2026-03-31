//! Voice storage — voice profiles via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProfileRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub provider: Option<String>,
    pub model_id: Option<String>,
    pub sample_url: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_profiles(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<VoiceProfileRow>, sqlx::Error> {
    sqlx::query_as::<_, VoiceProfileRow>(
        "SELECT * FROM voice.profiles ORDER BY name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_profile(pool: &PgPool, id: &str) -> Result<Option<VoiceProfileRow>, sqlx::Error> {
    sqlx::query_as::<_, VoiceProfileRow>("SELECT * FROM voice.profiles WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn clone_profile(
    pool: &PgPool,
    source_id: &str,
    new_name: &str,
) -> Result<Option<VoiceProfileRow>, sqlx::Error> {
    let new_id = uuid::Uuid::now_v7().to_string();
    let now = now_ms();
    sqlx::query_as::<_, VoiceProfileRow>(
        "INSERT INTO voice.profiles (id, name, description, language, provider, model_id, sample_url, created_at, updated_at)
         SELECT $1, $2, description, language, provider, model_id, sample_url, $3, $3
         FROM voice.profiles WHERE id = $4
         RETURNING *",
    )
    .bind(&new_id)
    .bind(new_name)
    .bind(now)
    .bind(source_id)
    .fetch_optional(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
