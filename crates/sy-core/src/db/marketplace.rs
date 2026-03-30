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
