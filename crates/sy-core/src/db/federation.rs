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

// ---------------------------------------------------------------------------
// Federated learning — sessions
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FederatedSessionRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_federated_sessions(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<FederatedSessionRow>, sqlx::Error> {
    sqlx::query_as::<_, FederatedSessionRow>(
        "SELECT * FROM federation.learning_sessions WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_federated_session(
    pool: &PgPool,
    session_id: &str,
) -> Result<Option<FederatedSessionRow>, sqlx::Error> {
    sqlx::query_as::<_, FederatedSessionRow>(
        "SELECT * FROM federation.learning_sessions WHERE id = $1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
}

pub async fn create_federated_session(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    config: &serde_json::Value,
) -> Result<FederatedSessionRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, FederatedSessionRow>(
        "INSERT INTO federation.learning_sessions \
         (id, tenant_id, name, status, config, created_at, updated_at) \
         VALUES ($1, $2, $3, 'pending', $4, $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn update_federated_session_status(
    pool: &PgPool,
    session_id: &str,
    status: &str,
) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let r = sqlx::query(
        "UPDATE federation.learning_sessions SET status = $1, updated_at = $2 WHERE id = $3",
    )
    .bind(status)
    .bind(now)
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Federated learning — participants
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FederatedParticipantRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub last_heartbeat_at: Option<i64>,
    pub metadata: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_federated_participants(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<FederatedParticipantRow>, sqlx::Error> {
    sqlx::query_as::<_, FederatedParticipantRow>(
        "SELECT * FROM federation.participants WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn register_federated_participant(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    metadata: &serde_json::Value,
) -> Result<FederatedParticipantRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, FederatedParticipantRow>(
        "INSERT INTO federation.participants \
         (id, tenant_id, name, status, metadata, created_at, updated_at) \
         VALUES ($1, $2, $3, 'active', $4, $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(metadata)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn participant_heartbeat(
    pool: &PgPool,
    participant_id: &str,
) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let r = sqlx::query(
        "UPDATE federation.participants \
         SET last_heartbeat_at = $1, updated_at = $1 WHERE id = $2",
    )
    .bind(now)
    .bind(participant_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Federated learning — rounds
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FederatedRoundRow {
    pub id: String,
    pub session_id: String,
    pub round_number: i32,
    pub status: String,
    pub config: serde_json::Value,
    pub result: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_session_rounds(
    pool: &PgPool,
    session_id: &str,
) -> Result<Vec<FederatedRoundRow>, sqlx::Error> {
    sqlx::query_as::<_, FederatedRoundRow>(
        "SELECT * FROM federation.rounds WHERE session_id = $1 ORDER BY round_number ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
}

pub async fn create_session_round(
    pool: &PgPool,
    id: &str,
    session_id: &str,
    round_number: i32,
    config: &serde_json::Value,
) -> Result<FederatedRoundRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, FederatedRoundRow>(
        "INSERT INTO federation.rounds \
         (id, session_id, round_number, status, config, result, created_at, updated_at) \
         VALUES ($1, $2, $3, 'pending', $4, '{}', $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(session_id)
    .bind(round_number)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn get_round(
    pool: &PgPool,
    round_id: &str,
) -> Result<Option<FederatedRoundRow>, sqlx::Error> {
    sqlx::query_as::<_, FederatedRoundRow>("SELECT * FROM federation.rounds WHERE id = $1")
        .bind(round_id)
        .fetch_optional(pool)
        .await
}

// ---------------------------------------------------------------------------
// Federated learning — model updates
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ModelUpdateRow {
    pub id: String,
    pub round_id: String,
    pub participant_id: String,
    pub status: String,
    pub update_data: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn submit_model_update(
    pool: &PgPool,
    id: &str,
    round_id: &str,
    participant_id: &str,
    update_data: &serde_json::Value,
) -> Result<ModelUpdateRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ModelUpdateRow>(
        "INSERT INTO federation.model_updates \
         (id, round_id, participant_id, status, update_data, created_at, updated_at) \
         VALUES ($1, $2, $3, 'submitted', $4, $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(round_id)
    .bind(participant_id)
    .bind(update_data)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_round_updates(
    pool: &PgPool,
    round_id: &str,
) -> Result<Vec<ModelUpdateRow>, sqlx::Error> {
    sqlx::query_as::<_, ModelUpdateRow>(
        "SELECT * FROM federation.model_updates WHERE round_id = $1 ORDER BY created_at ASC",
    )
    .bind(round_id)
    .fetch_all(pool)
    .await
}

pub async fn aggregate_round(pool: &PgPool, round_id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let r = sqlx::query(
        "UPDATE federation.rounds SET status = 'aggregated', updated_at = $1 \
         WHERE id = $2 AND status IN ('pending', 'collecting')",
    )
    .bind(now)
    .bind(round_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
