//! Marketplace storage — community skills via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceSkillRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub category: Option<String>,
    pub tags: serde_json::Value,
    pub download_count: Option<i32>,
    pub rating: Option<f64>,
    pub instructions: Option<String>,
    pub tools: serde_json::Value,
    pub installed: Option<bool>,
    pub published_at: i64,
    pub updated_at: i64,
    pub source: String,
}

pub async fn list_skills(
    pool: &PgPool,
    category: Option<&str>,
    installed: Option<bool>,
    limit: i64,
    offset: i64,
) -> Result<Vec<MarketplaceSkillRow>, sqlx::Error> {
    if let Some(cat) = category {
        sqlx::query_as::<_, MarketplaceSkillRow>(
            "SELECT * FROM marketplace.skills WHERE category = $1 ORDER BY download_count DESC LIMIT $2 OFFSET $3",
        )
        .bind(cat).bind(limit).bind(offset)
        .fetch_all(pool).await
    } else if let Some(inst) = installed {
        sqlx::query_as::<_, MarketplaceSkillRow>(
            "SELECT * FROM marketplace.skills WHERE installed = $1 ORDER BY download_count DESC LIMIT $2 OFFSET $3",
        )
        .bind(inst).bind(limit).bind(offset)
        .fetch_all(pool).await
    } else {
        sqlx::query_as::<_, MarketplaceSkillRow>(
            "SELECT * FROM marketplace.skills ORDER BY download_count DESC LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    }
}

pub async fn get_skill(
    pool: &PgPool,
    id: &str,
) -> Result<Option<MarketplaceSkillRow>, sqlx::Error> {
    sqlx::query_as::<_, MarketplaceSkillRow>("SELECT * FROM marketplace.skills WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn get_marketplace_item(
    pool: &PgPool,
    id: &str,
) -> Result<Option<MarketplaceSkillRow>, sqlx::Error> {
    sqlx::query_as::<_, MarketplaceSkillRow>("SELECT * FROM marketplace.skills WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn install_item(
    pool: &PgPool,
    id: &str,
) -> Result<Option<MarketplaceSkillRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, MarketplaceSkillRow>(
        "UPDATE marketplace.skills SET installed = true, updated_at = $2 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(now)
    .fetch_optional(pool)
    .await
}

pub async fn uninstall_item(
    pool: &PgPool,
    id: &str,
) -> Result<Option<MarketplaceSkillRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, MarketplaceSkillRow>(
        "UPDATE marketplace.skills SET installed = false, updated_at = $2 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(now)
    .fetch_optional(pool)
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn publish_item(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    version: Option<&str>,
    category: Option<&str>,
    tools: &serde_json::Value,
    instructions: Option<&str>,
) -> Result<MarketplaceSkillRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, MarketplaceSkillRow>(
        "INSERT INTO marketplace.skills (id, name, description, version, category, tags, tools, instructions, source, published_at, updated_at) VALUES ($1, $2, $3, $4, $5, '[]', $6, $7, 'local', $8, $8) RETURNING *",
    )
    .bind(id).bind(name).bind(description).bind(version).bind(category)
    .bind(tools).bind(instructions).bind(now)
    .fetch_one(pool).await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CommunitySyncStatusRow {
    pub last_sync_at: Option<i64>,
    pub total_items: Option<i64>,
    pub status: String,
}

pub async fn get_community_sync_status(
    pool: &PgPool,
) -> Result<Option<CommunitySyncStatusRow>, sqlx::Error> {
    sqlx::query_as::<_, CommunitySyncStatusRow>(
        "SELECT last_sync_at, total_items, status FROM marketplace.community_sync ORDER BY last_sync_at DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
}

pub async fn trigger_community_sync(pool: &PgPool) -> Result<CommunitySyncStatusRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, CommunitySyncStatusRow>(
        "INSERT INTO marketplace.community_sync (last_sync_at, total_items, status) VALUES ($1, 0, 'syncing') RETURNING last_sync_at, total_items, status",
    )
    .bind(now)
    .fetch_one(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
