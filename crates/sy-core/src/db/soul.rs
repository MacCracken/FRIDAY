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

/// Skill row from soul.skills table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SkillRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub personality_id: String,
    pub enabled: bool,
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
    pub tenant_id: String,
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

/// Update an existing personality.
#[allow(clippy::too_many_arguments)]
pub async fn update_personality(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: &str,
    system_prompt: &str,
    traits: &serde_json::Value,
    body: Option<&serde_json::Value>,
    voice: Option<&str>,
    sex: Option<&str>,
    include_archetypes: Option<bool>,
    brain_config: Option<&serde_json::Value>,
    default_model: Option<&serde_json::Value>,
    tenant_id: &str,
) -> Result<Option<PersonalityRow>, sqlx::Error> {
    sqlx::query_as::<_, PersonalityRow>(
        "UPDATE soul.personalities SET
            name = $1, description = $2, system_prompt = $3, traits = $4,
            body = COALESCE($5, body),
            voice = COALESCE($6, voice),
            sex = COALESCE($7, sex),
            include_archetypes = COALESCE($8, include_archetypes),
            brain_config = COALESCE($9, brain_config),
            default_model = COALESCE($10, default_model),
            updated_at = $11
         WHERE id = $12 AND tenant_id = $13
         RETURNING *",
    )
    .bind(name)
    .bind(description)
    .bind(system_prompt)
    .bind(traits)
    .bind(body)
    .bind(voice)
    .bind(sex)
    .bind(include_archetypes)
    .bind(brain_config)
    .bind(default_model)
    .bind(now_ms())
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Disable a personality (set enabled/is_active = false).
pub async fn disable_personality(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE soul.personalities SET is_active = false, updated_at = $1 WHERE id = $2 AND tenant_id = $3",
    )
    .bind(now_ms())
    .bind(id)
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
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

/// List skills for the active personality.
pub async fn list_skills(
    pool: &PgPool,
    personality_id: &str,
    tenant_id: &str,
) -> Result<Vec<SkillRow>, sqlx::Error> {
    sqlx::query_as::<_, SkillRow>(
        "SELECT * FROM soul.skills WHERE personality_id = $1 AND tenant_id = $2 ORDER BY name ASC",
    )
    .bind(personality_id)
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

/// Create a skill.
#[allow(clippy::too_many_arguments)]
pub async fn create_skill(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: &str,
    personality_id: &str,
    config: &serde_json::Value,
    tenant_id: &str,
) -> Result<SkillRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, SkillRow>(
        "INSERT INTO soul.skills (id, name, description, personality_id, enabled, config, created_at, updated_at, tenant_id)
         VALUES ($1, $2, $3, $4, true, $5, $6, $6, $7)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(personality_id)
    .bind(config)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Delete a skill by ID.
pub async fn delete_skill(pool: &PgPool, id: &str, tenant_id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM soul.skills WHERE id = $1 AND tenant_id = $2")
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
