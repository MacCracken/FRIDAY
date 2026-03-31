//! Spirit storage — passions, inspirations, pains via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PassionRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub intensity: f64,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub personality_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InspirationRow {
    pub id: String,
    pub source: String,
    pub description: String,
    pub impact: f64,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub personality_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PainRow {
    pub id: String,
    pub trigger_name: String,
    pub description: String,
    pub severity: f64,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub personality_id: Option<String>,
}

pub async fn get_passion(pool: &PgPool, id: &str) -> Result<Option<PassionRow>, sqlx::Error> {
    sqlx::query_as::<_, PassionRow>("SELECT * FROM spirit.passions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn get_inspiration(
    pool: &PgPool,
    id: &str,
) -> Result<Option<InspirationRow>, sqlx::Error> {
    sqlx::query_as::<_, InspirationRow>("SELECT * FROM spirit.inspirations WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn get_pain(pool: &PgPool, id: &str) -> Result<Option<PainRow>, sqlx::Error> {
    sqlx::query_as::<_, PainRow>("SELECT * FROM spirit.pains WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn list_passions(
    pool: &PgPool,
    personality_id: Option<&str>,
) -> Result<Vec<PassionRow>, sqlx::Error> {
    if let Some(pid) = personality_id {
        sqlx::query_as::<_, PassionRow>(
            "SELECT * FROM spirit.passions WHERE personality_id = $1 ORDER BY intensity DESC",
        )
        .bind(pid)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, PassionRow>("SELECT * FROM spirit.passions ORDER BY intensity DESC")
            .fetch_all(pool)
            .await
    }
}

pub async fn list_inspirations(
    pool: &PgPool,
    personality_id: Option<&str>,
) -> Result<Vec<InspirationRow>, sqlx::Error> {
    if let Some(pid) = personality_id {
        sqlx::query_as::<_, InspirationRow>(
            "SELECT * FROM spirit.inspirations WHERE personality_id = $1 ORDER BY impact DESC",
        )
        .bind(pid)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, InspirationRow>(
            "SELECT * FROM spirit.inspirations ORDER BY impact DESC",
        )
        .fetch_all(pool)
        .await
    }
}

pub async fn list_pains(
    pool: &PgPool,
    personality_id: Option<&str>,
) -> Result<Vec<PainRow>, sqlx::Error> {
    if let Some(pid) = personality_id {
        sqlx::query_as::<_, PainRow>(
            "SELECT * FROM spirit.pains WHERE personality_id = $1 ORDER BY severity DESC",
        )
        .bind(pid)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, PainRow>("SELECT * FROM spirit.pains ORDER BY severity DESC")
            .fetch_all(pool)
            .await
    }
}
