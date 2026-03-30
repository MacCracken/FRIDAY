//! MCP storage — servers and tools via PostgreSQL.

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
    pub description: Option<String>,
    pub input_schema: Option<serde_json::Value>,
}

pub async fn list_tools(pool: &PgPool) -> Result<Vec<McpToolRow>, sqlx::Error> {
    sqlx::query_as::<_, McpToolRow>(
        "SELECT name, server_id, description, input_schema FROM mcp.server_tools ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await
}
