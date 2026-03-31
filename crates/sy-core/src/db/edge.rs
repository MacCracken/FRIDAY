//! Edge storage — fleet nodes and deployments.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EdgeNodeRow {
    pub id: String,
    pub name: String,
    pub status: String,
    pub capabilities: serde_json::Value,
    pub agent_version: Option<String>,
    pub os_version: Option<String>,
    pub last_heartbeat_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_nodes(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<EdgeNodeRow>, sqlx::Error> {
    sqlx::query_as::<_, EdgeNodeRow>(
        "SELECT * FROM edge.nodes ORDER BY name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn register_node(
    pool: &PgPool,
    id: &str,
    name: &str,
    capabilities: &serde_json::Value,
) -> Result<EdgeNodeRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, EdgeNodeRow>(
        "INSERT INTO edge.nodes (id, name, capabilities, created_at, updated_at) VALUES ($1, $2, $3, $4, $4) RETURNING *",
    )
    .bind(id).bind(name).bind(capabilities).bind(now)
    .fetch_one(pool).await
}

pub async fn get_node(pool: &PgPool, id: &str) -> Result<Option<EdgeNodeRow>, sqlx::Error> {
    sqlx::query_as::<_, EdgeNodeRow>("SELECT * FROM edge.nodes WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn update_node_heartbeat(
    pool: &PgPool,
    id: &str,
) -> Result<Option<EdgeNodeRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, EdgeNodeRow>(
        "UPDATE edge.nodes SET last_heartbeat_at = $2, updated_at = $2 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(now)
    .fetch_optional(pool)
    .await
}

pub async fn update_node_status(
    pool: &PgPool,
    id: &str,
    status: &str,
) -> Result<Option<EdgeNodeRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, EdgeNodeRow>(
        "UPDATE edge.nodes SET status = $2, updated_at = $3 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(status)
    .bind(now)
    .fetch_optional(pool)
    .await
}

pub async fn decommission_node(
    pool: &PgPool,
    id: &str,
) -> Result<Option<EdgeNodeRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, EdgeNodeRow>(
        "UPDATE edge.nodes SET status = 'decommissioned', updated_at = $2 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(now)
    .fetch_optional(pool)
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentRow {
    pub id: String,
    pub name: String,
    pub node_id: Option<String>,
    pub status: String,
    pub image: Option<String>,
    pub version: Option<String>,
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_deployments(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<DeploymentRow>, sqlx::Error> {
    sqlx::query_as::<_, DeploymentRow>(
        "SELECT * FROM edge.deployments ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn create_deployment(
    pool: &PgPool,
    id: &str,
    name: &str,
    node_id: Option<&str>,
    image: Option<&str>,
    version: Option<&str>,
    config: &serde_json::Value,
) -> Result<DeploymentRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, DeploymentRow>(
        "INSERT INTO edge.deployments (id, name, node_id, status, image, version, config, created_at, updated_at) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $7) RETURNING *",
    )
    .bind(id).bind(name).bind(node_id).bind(image).bind(version).bind(config).bind(now)
    .fetch_one(pool).await
}

pub async fn get_deployment(pool: &PgPool, id: &str) -> Result<Option<DeploymentRow>, sqlx::Error> {
    sqlx::query_as::<_, DeploymentRow>("SELECT * FROM edge.deployments WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
