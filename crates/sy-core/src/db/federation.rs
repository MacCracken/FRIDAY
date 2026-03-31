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
    pub features: Option<serde_json::Value>,
    pub last_health_at: Option<i64>,
    pub created_at: i64,
}

pub async fn list_peers(pool: &PgPool) -> Result<Vec<FederationPeerRow>, sqlx::Error> {
    sqlx::query_as::<_, FederationPeerRow>(
        "SELECT id, name, endpoint, status, trust_level, features, last_health_at, created_at FROM federation.peers ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await
}

/// Get a peer by ID.
pub async fn get_peer(pool: &PgPool, id: &str) -> Result<Option<FederationPeerRow>, sqlx::Error> {
    sqlx::query_as::<_, FederationPeerRow>(
        "SELECT id, name, endpoint, status, trust_level, features, last_health_at, created_at FROM federation.peers WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Create a new federation peer.
pub async fn create_peer(
    pool: &PgPool,
    id: &str,
    name: &str,
    endpoint: &str,
    trust_level: &str,
) -> Result<FederationPeerRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, FederationPeerRow>(
        "INSERT INTO federation.peers (id, name, endpoint, status, trust_level, created_at)
         VALUES ($1, $2, $3, 'pending', $4, $5)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(endpoint)
    .bind(trust_level)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Delete a peer by ID.
pub async fn delete_peer(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM federation.peers WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Update a peer's features.
pub async fn update_peer_features(
    pool: &PgPool,
    id: &str,
    features: &serde_json::Value,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE federation.peers SET features = $1 WHERE id = $2")
        .bind(features)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Record a health-check timestamp for a peer.
pub async fn update_peer_health(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let result = sqlx::query(
        "UPDATE federation.peers SET last_health_at = $1, status = 'healthy' WHERE id = $2",
    )
    .bind(now)
    .bind(id)
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
