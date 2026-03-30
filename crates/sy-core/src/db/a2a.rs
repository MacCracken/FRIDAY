//! A2A storage — agent-to-agent peers and messages.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct A2aPeerRow {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub trust_level: String,
    pub capabilities: serde_json::Value,
    pub status: String,
    pub last_seen_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_peers(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<A2aPeerRow>, sqlx::Error> {
    sqlx::query_as::<_, A2aPeerRow>("SELECT * FROM a2a.peers ORDER BY name ASC LIMIT $1 OFFSET $2")
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
}

pub async fn get_peer(pool: &PgPool, id: &str) -> Result<Option<A2aPeerRow>, sqlx::Error> {
    sqlx::query_as::<_, A2aPeerRow>("SELECT * FROM a2a.peers WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}
