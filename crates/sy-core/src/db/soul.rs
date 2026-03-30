//! Soul storage — personalities CRUD via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

/// Personality row from soul.personalities table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub traits: serde_json::Value,
    pub sex: String,
    pub voice: String,
    pub preferred_language: String,
    pub default_model: Option<serde_json::Value>,
    pub include_archetypes: bool,
    pub is_active: bool,
    pub body: serde_json::Value,
    pub brain_config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
    pub model_fallbacks: serde_json::Value,
    pub is_default: bool,
    pub inject_date_time: bool,
    pub empathy_resonance: bool,
    pub avatar_url: Option<String>,
    pub tenant_id: String,
    pub version: i32,
}

/// List all personalities.
pub async fn list_personalities(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Vec<PersonalityRow>, sqlx::Error> {
    sqlx::query_as::<_, PersonalityRow>(
        "SELECT * FROM soul.personalities WHERE tenant_id = $1 ORDER BY is_default DESC, name ASC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

/// Get a personality by ID.
pub async fn get_personality(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<Option<PersonalityRow>, sqlx::Error> {
    sqlx::query_as::<_, PersonalityRow>(
        "SELECT * FROM soul.personalities WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Get the active personality.
pub async fn get_active_personality(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Option<PersonalityRow>, sqlx::Error> {
    sqlx::query_as::<_, PersonalityRow>(
        "SELECT * FROM soul.personalities WHERE is_active = true AND tenant_id = $1 LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Create a new personality.
pub async fn create_personality(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: &str,
    system_prompt: &str,
    traits: &serde_json::Value,
    tenant_id: &str,
) -> Result<PersonalityRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, PersonalityRow>(
        "INSERT INTO soul.personalities (id, name, description, system_prompt, traits, created_at, updated_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(system_prompt)
    .bind(traits)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Activate a personality (deactivates all others in the tenant).
pub async fn activate_personality(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "UPDATE soul.personalities SET is_active = false, updated_at = $1 WHERE tenant_id = $2",
    )
    .bind(now_ms())
    .bind(tenant_id)
    .execute(&mut *tx)
    .await?;

    let result = sqlx::query("UPDATE soul.personalities SET is_active = true, updated_at = $1 WHERE id = $2 AND tenant_id = $3")
        .bind(now_ms())
        .bind(id)
        .bind(tenant_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(result.rows_affected() > 0)
}

/// Delete a personality by ID.
pub async fn delete_personality(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM soul.personalities WHERE id = $1 AND tenant_id = $2 AND is_default = false",
    )
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
