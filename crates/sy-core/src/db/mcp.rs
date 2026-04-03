//! MCP storage — servers, tools, and resources via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct McpServerRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub transport: Option<String>,
    pub command: Option<String>,
    pub args: serde_json::Value,
    pub url: Option<String>,
    pub env: serde_json::Value,
    pub enabled: Option<bool>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_servers(pool: &PgPool) -> Result<Vec<McpServerRow>, sqlx::Error> {
    sqlx::query_as::<_, McpServerRow>("SELECT * FROM mcp.servers ORDER BY name ASC")
        .fetch_all(pool)
        .await
}

pub async fn get_server(pool: &PgPool, id: &str) -> Result<Option<McpServerRow>, sqlx::Error> {
    sqlx::query_as::<_, McpServerRow>("SELECT * FROM mcp.servers WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct McpToolRow {
    pub name: String,
    pub server_id: String,
    pub server_name: Option<String>,
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
}

pub async fn list_tools(pool: &PgPool) -> Result<Vec<McpToolRow>, sqlx::Error> {
    sqlx::query_as::<_, McpToolRow>(
        "SELECT t.name, t.server_id, s.name as server_name, t.description, t.input_schema
         FROM mcp.server_tools t
         LEFT JOIN mcp.servers s ON t.server_id = s.id
         ORDER BY t.name ASC",
    )
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceRow {
    pub id: String,
    pub server_id: String,
    pub uri: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub mime_type: Option<String>,
    pub created_at: i64,
}

pub async fn list_resources(pool: &PgPool) -> Result<Vec<McpResourceRow>, sqlx::Error> {
    sqlx::query_as::<_, McpResourceRow>("SELECT * FROM mcp.resources ORDER BY name ASC")
        .fetch_all(pool)
        .await
}

pub async fn get_mcp_server(pool: &PgPool, id: &str) -> Result<Option<McpServerRow>, sqlx::Error> {
    sqlx::query_as::<_, McpServerRow>("SELECT * FROM mcp.servers WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigRow {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct McpCredentialRow {
    pub server_id: String,
    pub key: String,
    pub created_at: i64,
}

pub async fn list_server_credentials(
    pool: &PgPool,
    server_id: &str,
) -> Result<Vec<McpCredentialRow>, sqlx::Error> {
    sqlx::query_as::<_, McpCredentialRow>(
        "SELECT server_id, key, created_at FROM mcp.server_credentials WHERE server_id = $1 ORDER BY key ASC",
    )
    .bind(server_id)
    .fetch_all(pool)
    .await
}

pub async fn delete_server_credential(
    pool: &PgPool,
    server_id: &str,
    key: &str,
) -> Result<bool, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM mcp.server_credentials WHERE server_id = $1 AND key = $2")
            .bind(server_id)
            .bind(key)
            .execute(pool)
            .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn get_config(pool: &PgPool) -> Result<Vec<McpConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, McpConfigRow>("SELECT key, value FROM mcp.config ORDER BY key ASC")
        .fetch_all(pool)
        .await
}
