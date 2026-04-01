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

/// Update an existing profile (partial update).
#[allow(clippy::too_many_arguments)]
pub async fn update_profile(
    pool: &PgPool,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    system_prompt: Option<&str>,
    allowed_tools: Option<&serde_json::Value>,
    default_model: Option<&str>,
) -> Result<Option<AgentProfileRow>, sqlx::Error> {
    // Check builtin guard
    let existing = get_profile(pool, id).await?;
    match existing {
        None => return Ok(None),
        Some(ref p) if p.is_builtin => return Ok(None),
        _ => {}
    }
    sqlx::query_as::<_, AgentProfileRow>(
        "UPDATE agents.profiles SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            system_prompt = COALESCE($4, system_prompt),
            allowed_tools = COALESCE($5, allowed_tools),
            default_model = COALESCE($6, default_model),
            updated_at = NOW()
         WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(system_prompt)
    .bind(allowed_tools)
    .bind(default_model)
    .fetch_optional(pool)
    .await
}

/// Get delegation messages (delegation conversation).
pub async fn get_delegation_messages(
    pool: &PgPool,
    delegation_id: &str,
) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT row_to_json(m) FROM agents.delegation_messages m WHERE delegation_id = $1 ORDER BY created_at ASC",
    )
    .bind(delegation_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── Swarm Templates & Runs ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SwarmTemplateRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub strategy: String,
    pub roles: serde_json::Value,
    pub coordinator_profile: Option<String>,
    pub is_builtin: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SwarmRunRow {
    pub id: String,
    pub template_id: String,
    pub task: String,
    pub context: Option<String>,
    pub status: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub token_budget: i32,
    pub tokens_used: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn list_swarm_templates(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<SwarmTemplateRow>, sqlx::Error> {
    sqlx::query_as::<_, SwarmTemplateRow>(
        "SELECT * FROM agents.swarm_templates ORDER BY is_builtin DESC, name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_swarm_template(
    pool: &PgPool,
    id: &str,
) -> Result<Option<SwarmTemplateRow>, sqlx::Error> {
    sqlx::query_as::<_, SwarmTemplateRow>("SELECT * FROM agents.swarm_templates WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_swarm_template(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: &str,
    strategy: &str,
    roles: &serde_json::Value,
    coordinator_profile: Option<&str>,
) -> Result<SwarmTemplateRow, sqlx::Error> {
    sqlx::query_as::<_, SwarmTemplateRow>(
        "INSERT INTO agents.swarm_templates (id, name, description, strategy, roles, coordinator_profile)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(strategy)
    .bind(roles)
    .bind(coordinator_profile)
    .fetch_one(pool)
    .await
}

pub async fn update_swarm_template(
    pool: &PgPool,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    strategy: Option<&str>,
    roles: Option<&serde_json::Value>,
) -> Result<Option<SwarmTemplateRow>, sqlx::Error> {
    sqlx::query_as::<_, SwarmTemplateRow>(
        "UPDATE agents.swarm_templates SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            strategy = COALESCE($4, strategy),
            roles = COALESCE($5, roles),
            updated_at = NOW()
         WHERE id = $1 AND is_builtin = false RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(strategy)
    .bind(roles)
    .fetch_optional(pool)
    .await
}

pub async fn delete_swarm_template(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM agents.swarm_templates WHERE id = $1 AND is_builtin = false")
            .bind(id)
            .execute(pool)
            .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn list_swarm_runs(
    pool: &PgPool,
    status: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<SwarmRunRow>, sqlx::Error> {
    if let Some(s) = status {
        sqlx::query_as::<_, SwarmRunRow>(
            "SELECT * FROM agents.swarm_runs WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(s)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, SwarmRunRow>(
            "SELECT * FROM agents.swarm_runs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    }
}

pub async fn get_swarm_run(pool: &PgPool, id: &str) -> Result<Option<SwarmRunRow>, sqlx::Error> {
    sqlx::query_as::<_, SwarmRunRow>("SELECT * FROM agents.swarm_runs WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_swarm_run(
    pool: &PgPool,
    id: &str,
    template_id: &str,
    task: &str,
    context: Option<&str>,
    token_budget: i32,
) -> Result<SwarmRunRow, sqlx::Error> {
    sqlx::query_as::<_, SwarmRunRow>(
        "INSERT INTO agents.swarm_runs (id, template_id, task, context, status, token_budget, tokens_used)
         VALUES ($1, $2, $3, $4, 'pending', $5, 0) RETURNING *",
    )
    .bind(id)
    .bind(template_id)
    .bind(task)
    .bind(context)
    .bind(token_budget)
    .fetch_one(pool)
    .await
}

pub async fn cancel_swarm_run(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE agents.swarm_runs SET status = 'cancelled', completed_at = NOW() WHERE id = $1 AND status IN ('pending', 'running')",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

// ── Council Templates & Runs ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CouncilTemplateRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub members: serde_json::Value,
    pub facilitator_profile: Option<String>,
    pub deliberation_strategy: String,
    pub voting_strategy: String,
    pub max_rounds: i32,
    pub is_builtin: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CouncilRunRow {
    pub id: String,
    pub template_id: String,
    pub topic: String,
    pub context: Option<String>,
    pub status: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub rounds_completed: i32,
    pub max_rounds: i32,
    pub token_budget: i32,
    pub tokens_used: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn list_council_templates(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<CouncilTemplateRow>, sqlx::Error> {
    sqlx::query_as::<_, CouncilTemplateRow>(
        "SELECT * FROM agents.council_templates ORDER BY is_builtin DESC, name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_council_template(
    pool: &PgPool,
    id: &str,
) -> Result<Option<CouncilTemplateRow>, sqlx::Error> {
    sqlx::query_as::<_, CouncilTemplateRow>("SELECT * FROM agents.council_templates WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_council_template(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: &str,
    members: &serde_json::Value,
    facilitator_profile: Option<&str>,
    deliberation_strategy: &str,
    voting_strategy: &str,
    max_rounds: i32,
) -> Result<CouncilTemplateRow, sqlx::Error> {
    sqlx::query_as::<_, CouncilTemplateRow>(
        "INSERT INTO agents.council_templates (id, name, description, members, facilitator_profile, deliberation_strategy, voting_strategy, max_rounds)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(members)
    .bind(facilitator_profile)
    .bind(deliberation_strategy)
    .bind(voting_strategy)
    .bind(max_rounds)
    .fetch_one(pool)
    .await
}

pub async fn update_council_template(
    pool: &PgPool,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    members: Option<&serde_json::Value>,
    deliberation_strategy: Option<&str>,
    voting_strategy: Option<&str>,
    max_rounds: Option<i32>,
) -> Result<Option<CouncilTemplateRow>, sqlx::Error> {
    sqlx::query_as::<_, CouncilTemplateRow>(
        "UPDATE agents.council_templates SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            members = COALESCE($4, members),
            deliberation_strategy = COALESCE($5, deliberation_strategy),
            voting_strategy = COALESCE($6, voting_strategy),
            max_rounds = COALESCE($7, max_rounds),
            updated_at = NOW()
         WHERE id = $1 AND is_builtin = false RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(members)
    .bind(deliberation_strategy)
    .bind(voting_strategy)
    .bind(max_rounds)
    .fetch_optional(pool)
    .await
}

pub async fn delete_council_template(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM agents.council_templates WHERE id = $1 AND is_builtin = false")
            .bind(id)
            .execute(pool)
            .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn list_council_runs(
    pool: &PgPool,
    status: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<CouncilRunRow>, sqlx::Error> {
    if let Some(s) = status {
        sqlx::query_as::<_, CouncilRunRow>(
            "SELECT * FROM agents.council_runs WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(s)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, CouncilRunRow>(
            "SELECT * FROM agents.council_runs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    }
}

pub async fn get_council_run(
    pool: &PgPool,
    id: &str,
) -> Result<Option<CouncilRunRow>, sqlx::Error> {
    sqlx::query_as::<_, CouncilRunRow>("SELECT * FROM agents.council_runs WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_council_run(
    pool: &PgPool,
    id: &str,
    template_id: &str,
    topic: &str,
    context: Option<&str>,
    token_budget: i32,
    max_rounds: i32,
) -> Result<CouncilRunRow, sqlx::Error> {
    sqlx::query_as::<_, CouncilRunRow>(
        "INSERT INTO agents.council_runs (id, template_id, topic, context, status, rounds_completed, max_rounds, token_budget, tokens_used)
         VALUES ($1, $2, $3, $4, 'pending', 0, $5, $6, 0) RETURNING *",
    )
    .bind(id)
    .bind(template_id)
    .bind(topic)
    .bind(context)
    .bind(max_rounds)
    .bind(token_budget)
    .fetch_one(pool)
    .await
}

pub async fn cancel_council_run(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE agents.council_runs SET status = 'cancelled', completed_at = NOW() WHERE id = $1 AND status IN ('pending', 'running')",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

// ── Teams ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TeamRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub members: serde_json::Value,
    pub is_builtin: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TeamRunRow {
    pub id: String,
    pub team_id: String,
    pub task: String,
    pub context: Option<String>,
    pub status: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub token_budget: i32,
    pub tokens_used: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn list_teams(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<TeamRow>, sqlx::Error> {
    sqlx::query_as::<_, TeamRow>(
        "SELECT * FROM agents.teams ORDER BY is_builtin DESC, name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_team(pool: &PgPool, id: &str) -> Result<Option<TeamRow>, sqlx::Error> {
    sqlx::query_as::<_, TeamRow>("SELECT * FROM agents.teams WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_team(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: &str,
    members: &serde_json::Value,
) -> Result<TeamRow, sqlx::Error> {
    sqlx::query_as::<_, TeamRow>(
        "INSERT INTO agents.teams (id, name, description, members) VALUES ($1, $2, $3, $4) RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(members)
    .fetch_one(pool)
    .await
}

pub async fn update_team(
    pool: &PgPool,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    members: Option<&serde_json::Value>,
) -> Result<Option<TeamRow>, sqlx::Error> {
    sqlx::query_as::<_, TeamRow>(
        "UPDATE agents.teams SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            members = COALESCE($4, members),
            updated_at = NOW()
         WHERE id = $1 AND is_builtin = false RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(members)
    .fetch_optional(pool)
    .await
}

pub async fn delete_team(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM agents.teams WHERE id = $1 AND is_builtin = false")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn list_team_runs(
    pool: &PgPool,
    status: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<TeamRunRow>, sqlx::Error> {
    if let Some(s) = status {
        sqlx::query_as::<_, TeamRunRow>(
            "SELECT * FROM agents.team_runs WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(s)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, TeamRunRow>(
            "SELECT * FROM agents.team_runs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    }
}

pub async fn get_team_run(pool: &PgPool, id: &str) -> Result<Option<TeamRunRow>, sqlx::Error> {
    sqlx::query_as::<_, TeamRunRow>("SELECT * FROM agents.team_runs WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_team_run(
    pool: &PgPool,
    id: &str,
    team_id: &str,
    task: &str,
    context: Option<&str>,
    token_budget: i32,
) -> Result<TeamRunRow, sqlx::Error> {
    sqlx::query_as::<_, TeamRunRow>(
        "INSERT INTO agents.team_runs (id, team_id, task, context, status, token_budget, tokens_used)
         VALUES ($1, $2, $3, $4, 'pending', $5, 0) RETURNING *",
    )
    .bind(id)
    .bind(team_id)
    .bind(task)
    .bind(context)
    .bind(token_budget)
    .fetch_one(pool)
    .await
}

// ── Profile Skills ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSkillRow {
    pub profile_id: String,
    pub skill_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_profile_skills(
    pool: &PgPool,
    profile_id: &str,
) -> Result<Vec<ProfileSkillRow>, sqlx::Error> {
    sqlx::query_as::<_, ProfileSkillRow>(
        "SELECT * FROM agents.profile_skills WHERE profile_id = $1 ORDER BY created_at ASC",
    )
    .bind(profile_id)
    .fetch_all(pool)
    .await
}

pub async fn add_profile_skill(
    pool: &PgPool,
    profile_id: &str,
    skill_id: &str,
) -> Result<ProfileSkillRow, sqlx::Error> {
    sqlx::query_as::<_, ProfileSkillRow>(
        "INSERT INTO agents.profile_skills (profile_id, skill_id) VALUES ($1, $2)
         ON CONFLICT (profile_id, skill_id) DO NOTHING RETURNING *",
    )
    .bind(profile_id)
    .bind(skill_id)
    .fetch_one(pool)
    .await
}

pub async fn remove_profile_skill(
    pool: &PgPool,
    profile_id: &str,
    skill_id: &str,
) -> Result<bool, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM agents.profile_skills WHERE profile_id = $1 AND skill_id = $2")
            .bind(profile_id)
            .bind(skill_id)
            .execute(pool)
            .await?;
    Ok(result.rows_affected() > 0)
}
