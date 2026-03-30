//! Federation storage — peer nodes.
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FederationPeerRow {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub status: String,
    pub trust_level: String,
    pub created_at: i64,
}

pub async fn list_peers(pool: &PgPool) -> Result<Vec<FederationPeerRow>, sqlx::Error> {
    sqlx::query_as::<_, FederationPeerRow>("SELECT id, name, endpoint, status, trust_level, created_at FROM federation.peers ORDER BY name ASC")
        .fetch_all(pool).await
}
