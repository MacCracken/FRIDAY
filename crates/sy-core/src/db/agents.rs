//! Agent storage — profiles, delegations, swarms via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub system_prompt: String,
    pub max_token_budget: i32,
    pub allowed_tools: serde_json::Value,
    pub default_model: Option<String>,
    pub is_builtin: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub r#type: String,
    pub command: Option<String>,
    pub command_args: Option<serde_json::Value>,
    pub command_env: Option<serde_json::Value>,
    pub mcp_tool: Option<String>,
    pub mcp_tool_input: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DelegationRow {
    pub id: String,
    pub parent_delegation_id: Option<String>,
    pub profile_id: String,
    pub task: String,
    pub context: Option<String>,
    pub status: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub depth: i32,
    pub max_depth: i32,
    pub token_budget: i32,
    pub tokens_used_prompt: i32,
    pub tokens_used_completion: i32,
    pub timeout_ms: i32,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub initiated_by: Option<String>,
    pub correlation_id: Option<String>,
}

pub async fn list_profiles(pool: &PgPool) -> Result<Vec<AgentProfileRow>, sqlx::Error> {
    sqlx::query_as::<_, AgentProfileRow>(
        "SELECT * FROM agents.profiles ORDER BY is_builtin DESC, name ASC",
    )
    .fetch_all(pool)
    .await
}

pub async fn get_profile(pool: &PgPool, id: &str) -> Result<Option<AgentProfileRow>, sqlx::Error> {
    sqlx::query_as::<_, AgentProfileRow>("SELECT * FROM agents.profiles WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// Get an agent by ID (alias for get_profile, used by /agents/{id} route).
pub async fn get_agent(pool: &PgPool, id: &str) -> Result<Option<AgentProfileRow>, sqlx::Error> {
    get_profile(pool, id).await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_profile(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: &str,
    system_prompt: &str,
    allowed_tools: &serde_json::Value,
    default_model: Option<&str>,
    profile_type: &str,
) -> Result<AgentProfileRow, sqlx::Error> {
    sqlx::query_as::<_, AgentProfileRow>(
        "INSERT INTO agents.profiles (id, name, description, system_prompt, allowed_tools, default_model, type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(system_prompt)
    .bind(allowed_tools)
    .bind(default_model)
    .bind(profile_type)
    .fetch_one(pool)
    .await
}

pub async fn delete_profile(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM agents.profiles WHERE id = $1 AND is_builtin = false")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn list_delegations(
    pool: &PgPool,
    status: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<DelegationRow>, sqlx::Error> {
    if let Some(s) = status {
        sqlx::query_as::<_, DelegationRow>(
            "SELECT * FROM agents.delegations WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(s)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, DelegationRow>(
            "SELECT * FROM agents.delegations ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    }
}

/// List active delegations (status = 'running').
pub async fn list_active_delegations(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<DelegationRow>, sqlx::Error> {
    sqlx::query_as::<_, DelegationRow>(
        "SELECT * FROM agents.delegations WHERE status = 'running' ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_delegation(pool: &PgPool, id: &str) -> Result<Option<DelegationRow>, sqlx::Error> {
    sqlx::query_as::<_, DelegationRow>("SELECT * FROM agents.delegations WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

/// Create a new delegation.
#[allow(clippy::too_many_arguments)]
pub async fn create_delegation(
    pool: &PgPool,
    id: &str,
    profile_id: &str,
    task: &str,
    context: Option<&str>,
    initiated_by: Option<&str>,
    max_depth: i32,
    token_budget: i32,
    timeout_ms: i32,
) -> Result<DelegationRow, sqlx::Error> {
    sqlx::query_as::<_, DelegationRow>(
        "INSERT INTO agents.delegations (id, profile_id, task, context, status, depth, max_depth, token_budget, tokens_used_prompt, tokens_used_completion, timeout_ms, initiated_by)
         VALUES ($1, $2, $3, $4, 'running', 0, $5, $6, 0, 0, $7, $8)
         RETURNING *",
    )
    .bind(id)
    .bind(profile_id)
    .bind(task)
    .bind(context)
    .bind(max_depth)
    .bind(token_budget)
    .bind(timeout_ms)
    .bind(initiated_by)
    .fetch_one(pool)
    .await
}

/// Cancel a delegation by ID.
pub async fn cancel_delegation(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE agents.delegations SET status = 'cancelled', completed_at = NOW() WHERE id = $1 AND status = 'running'",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}
