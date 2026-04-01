//! Agent routes — profiles, delegations, swarms, councils, teams, profile skills.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, patch, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::agents;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // ── Profiles ──
        .route("/api/v1/agents/profiles", get(list_profiles))
        .route("/api/v1/agents/profiles", post(create_profile))
        .route("/api/v1/agents/profiles/{id}", get(get_profile))
        .route("/api/v1/agents/profiles/{id}", put(update_profile))
        .route("/api/v1/agents/profiles/{id}", delete(delete_profile))
        .route(
            "/api/v1/agents/profiles/{id}/skills",
            get(list_profile_skills),
        )
        .route(
            "/api/v1/agents/profiles/{id}/skills",
            post(add_profile_skill),
        )
        .route(
            "/api/v1/agents/profiles/{profileId}/skills/{skillId}",
            delete(remove_profile_skill),
        )
        .route("/api/v1/agents/{id}", get(get_agent))
        // ── Config ──
        .route("/api/v1/agents/config", get(get_agent_config))
        .route("/api/v1/agents/config", patch(update_agent_config))
        // ── Delegations ──
        .route("/api/v1/agents/delegate", post(delegate_task))
        .route(
            "/api/v1/agents/delegations/active",
            get(list_active_delegations),
        )
        .route("/api/v1/agents/delegations", get(list_delegations))
        .route("/api/v1/agents/delegations/{id}", get(get_delegation))
        .route(
            "/api/v1/agents/delegations/{id}/cancel",
            post(cancel_delegation),
        )
        .route(
            "/api/v1/agents/delegations/{id}/messages",
            get(get_delegation_messages),
        )
        // ── Swarm Templates ──
        .route("/api/v1/agents/swarms/templates", get(list_swarm_templates))
        .route(
            "/api/v1/agents/swarms/templates",
            post(create_swarm_template),
        )
        .route(
            "/api/v1/agents/swarms/templates/{id}",
            get(get_swarm_template),
        )
        .route(
            "/api/v1/agents/swarms/templates/{id}",
            patch(update_swarm_template),
        )
        .route(
            "/api/v1/agents/swarms/templates/{id}",
            delete(delete_swarm_template),
        )
        .route(
            "/api/v1/agents/swarms/templates/{id}/export",
            get(export_swarm_template),
        )
        .route(
            "/api/v1/agents/swarms/templates/import",
            post(import_swarm_template),
        )
        // ── Swarm Runs ──
        .route("/api/v1/agents/swarms", get(list_swarm_runs))
        .route("/api/v1/agents/swarms", post(execute_swarm))
        .route("/api/v1/agents/swarms/{id}", get(get_swarm_run))
        .route("/api/v1/agents/swarms/{id}/cancel", post(cancel_swarm))
        // ── Council Templates ──
        .route("/api/v1/agents/councils/catalog", get(get_council_catalog))
        .route(
            "/api/v1/agents/councils/catalog/{name}/install",
            post(install_council_from_catalog),
        )
        .route(
            "/api/v1/agents/councils/templates",
            get(list_council_templates),
        )
        .route(
            "/api/v1/agents/councils/templates",
            post(create_council_template),
        )
        .route(
            "/api/v1/agents/councils/templates/{id}",
            get(get_council_template),
        )
        .route(
            "/api/v1/agents/councils/templates/{id}",
            put(update_council_template),
        )
        .route(
            "/api/v1/agents/councils/templates/{id}",
            delete(delete_council_template),
        )
        // ── Council Runs ──
        .route("/api/v1/agents/councils", post(convene_council))
        .route("/api/v1/agents/councils/runs", get(list_council_runs))
        .route("/api/v1/agents/councils/runs/{id}", get(get_council_run))
        .route(
            "/api/v1/agents/councils/runs/{id}/cancel",
            post(cancel_council_run),
        )
        // ── Teams ──
        .route("/api/v1/agents/teams", get(list_teams))
        .route("/api/v1/agents/teams", post(create_team))
        .route("/api/v1/agents/teams/runs/{runId}", get(get_team_run))
        .route("/api/v1/agents/teams/{id}", get(get_team))
        .route("/api/v1/agents/teams/{id}", put(update_team))
        .route("/api/v1/agents/teams/{id}", delete(delete_team))
        .route("/api/v1/agents/teams/{id}/run", post(run_team))
}

async fn list_profiles(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agents::list_profiles(pool).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProfileRequest {
    name: String,
    #[serde(default)]
    description: String,
    system_prompt: String,
    #[serde(default = "default_tools")]
    allowed_tools: serde_json::Value,
    default_model: Option<String>,
    #[serde(default = "default_type")]
    r#type: String,
}

fn default_tools() -> serde_json::Value {
    serde_json::json!([])
}
fn default_type() -> String {
    "llm".to_string()
}

async fn create_profile(
    State(state): State<AppState>,
    Json(body): Json<CreateProfileRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match agents::create_profile(
        pool,
        &id,
        &body.name,
        &body.description,
        &body.system_prompt,
        &body.allowed_tools,
        body.default_model.as_deref(),
        &body.r#type,
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_profile(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agents::get_profile(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Profile not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_profile(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match agents::delete_profile(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Profile not found or is builtin"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_agent(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agents::get_agent(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Agent not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_agent_config(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agents::list_profiles(pool).await {
        Ok(profiles) => {
            let builtin_count = profiles.iter().filter(|p| p.is_builtin).count();
            let custom_count = profiles.len() - builtin_count;
            Json(serde_json::json!({
                "totalProfiles": profiles.len(),
                "builtinCount": builtin_count,
                "customCount": custom_count,
                "delegationEnabled": true,
            }))
            .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DelegateTaskRequest {
    profile_id: String,
    task: String,
    context: Option<String>,
    initiated_by: Option<String>,
    #[serde(default = "default_max_depth")]
    max_depth: i32,
    #[serde(default = "default_token_budget")]
    token_budget: i32,
    #[serde(default = "default_timeout_ms")]
    timeout_ms: i32,
}

fn default_max_depth() -> i32 {
    3
}
fn default_token_budget() -> i32 {
    4096
}
fn default_timeout_ms() -> i32 {
    60000
}

async fn delegate_task(
    State(state): State<AppState>,
    Json(body): Json<DelegateTaskRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match agents::create_delegation(
        pool,
        &id,
        &body.profile_id,
        &body.task,
        body.context.as_deref(),
        body.initiated_by.as_deref(),
        body.max_depth,
        body.token_budget,
        body.timeout_ms,
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct ActiveDelegationQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

async fn list_active_delegations(
    State(state): State<AppState>,
    Query(q): Query<ActiveDelegationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agents::list_active_delegations(pool, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct DelegationQuery {
    status: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

async fn list_delegations(
    State(state): State<AppState>,
    Query(q): Query<DelegationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agents::list_delegations(pool, q.status.as_deref(), q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_delegation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agents::get_delegation(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Delegation not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn cancel_delegation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match agents::cancel_delegation(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Delegation not found or not running"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Missing agent routes ────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProfileRequest {
    name: Option<String>,
    description: Option<String>,
    system_prompt: Option<String>,
    allowed_tools: Option<serde_json::Value>,
    default_model: Option<String>,
}

async fn update_profile(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateProfileRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::update_profile(
        pool,
        &id,
        body.name.as_deref(),
        body.description.as_deref(),
        body.system_prompt.as_deref(),
        body.allowed_tools.as_ref(),
        body.default_model.as_deref(),
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Profile not found or is builtin"})),
        )
            .into_response(),
        Err(e) => err_internal(&e),
    }
}

async fn get_delegation_messages(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::get_delegation_messages(pool, &id).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => err_internal(&e),
    }
}

#[derive(Deserialize)]
struct UpdateConfigRequest {
    enabled: Option<bool>,
}

async fn update_agent_config(
    State(_state): State<AppState>,
    Json(body): Json<UpdateConfigRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "delegationEnabled": body.enabled.unwrap_or(true),
    }))
    .into_response()
}

// ── Swarm Template Handlers ─────────────────────────────────────────────────

async fn list_swarm_templates(
    State(state): State<AppState>,
    Query(q): Query<PaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::list_swarm_templates(pool, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => err_internal(&e),
    }
}

async fn get_swarm_template(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::get_swarm_template(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Swarm template not found"),
        Err(e) => err_internal(&e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSwarmTemplateRequest {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_swarm_strategy")]
    strategy: String,
    #[serde(default)]
    roles: serde_json::Value,
    coordinator_profile: Option<String>,
}

fn default_swarm_strategy() -> String {
    "parallel".to_string()
}

async fn create_swarm_template(
    State(state): State<AppState>,
    Json(body): Json<CreateSwarmTemplateRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match agents::create_swarm_template(
        pool,
        &id,
        &body.name,
        &body.description,
        &body.strategy,
        &body.roles,
        body.coordinator_profile.as_deref(),
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => err_internal(&e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSwarmTemplateRequest {
    name: Option<String>,
    description: Option<String>,
    strategy: Option<String>,
    roles: Option<serde_json::Value>,
}

async fn update_swarm_template(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateSwarmTemplateRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::update_swarm_template(
        pool,
        &id,
        body.name.as_deref(),
        body.description.as_deref(),
        body.strategy.as_deref(),
        body.roles.as_ref(),
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Swarm template not found or is builtin"),
        Err(e) => err_internal(&e),
    }
}

async fn delete_swarm_template(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match agents::delete_swarm_template(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Swarm template not found or is builtin"),
        Err(e) => err_internal(&e),
    }
}

async fn export_swarm_template(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::get_swarm_template(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "template": row,
            "version": "1.0",
            "exportedAt": chrono::Utc::now(),
        }))
        .into_response(),
        Ok(None) => not_found("Swarm template not found"),
        Err(e) => err_internal(&e),
    }
}

async fn import_swarm_template(
    State(state): State<AppState>,
    Json(body): Json<CreateSwarmTemplateRequest>,
) -> impl IntoResponse {
    create_swarm_template(State(state), Json(body)).await
}

// ── Swarm Run Handlers ──────────────────────────────────────────────────────

async fn list_swarm_runs(
    State(state): State<AppState>,
    Query(q): Query<StatusPaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::list_swarm_runs(pool, q.status.as_deref(), q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => err_internal(&e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteSwarmRequest {
    template_id: String,
    task: String,
    context: Option<String>,
    #[serde(default = "default_token_budget")]
    token_budget: i32,
}

async fn execute_swarm(
    State(state): State<AppState>,
    Json(body): Json<ExecuteSwarmRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match agents::create_swarm_run(
        pool,
        &id,
        &body.template_id,
        &body.task,
        body.context.as_deref(),
        body.token_budget,
    )
    .await
    {
        Ok(row) => {
            // Fire-and-forget: transition to running asynchronously.
            let pool = pool.clone();
            let run_id = id.clone();
            let template_id = body.template_id.clone();
            let task = body.task.clone();
            let context = body.context.clone();
            let token_budget = body.token_budget as u32;
            tokio::spawn(async move {
                let _ = agents::start_swarm_run(&pool, &run_id).await;

                // Load template and execute swarm
                match agents::get_swarm_template(&pool, &template_id).await {
                    Ok(Some(template)) => {
                        let delegate = crate::orchestration::hoosh::HooshDelegate::from_env();
                        let executor =
                            crate::orchestration::swarm::SwarmExecutor::new(delegate, pool.clone());
                        match executor
                            .execute(&run_id, &template, &task, context.as_deref(), token_budget)
                            .await
                        {
                            Ok(result) => {
                                tracing::info!(run_id = %run_id, tokens = result.tokens_used, "swarm completed")
                            }
                            Err(e) => {
                                let _ = sqlx::query("UPDATE agents.swarm_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2")
                                    .bind(e.to_string()).bind(&run_id).execute(&pool).await;
                                tracing::error!(run_id = %run_id, error = %e, "swarm failed");
                            }
                        }
                    }
                    _ => tracing::error!(run_id = %run_id, "swarm template not found"),
                }
            });
            (
                StatusCode::CREATED,
                Json(serde_json::to_value(row).unwrap()),
            )
                .into_response()
        }
        Err(e) => err_internal(&e),
    }
}

async fn get_swarm_run(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::get_swarm_run(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Swarm run not found"),
        Err(e) => err_internal(&e),
    }
}

async fn cancel_swarm(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match agents::cancel_swarm_run(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Swarm run not found or not active"),
        Err(e) => err_internal(&e),
    }
}

// ── Council Template Handlers ───────────────────────────────────────────────

async fn get_council_catalog(State(_state): State<AppState>) -> impl IntoResponse {
    // Built-in council catalog — static for now, will be populated from presets
    Json(serde_json::json!({
        "templates": [],
    }))
    .into_response()
}

async fn install_council_from_catalog(
    State(_state): State<AppState>,
    Path(_name): Path<String>,
) -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"error": "Catalog template not found"})),
    )
        .into_response()
}

async fn list_council_templates(
    State(state): State<AppState>,
    Query(q): Query<PaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::list_council_templates(pool, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => err_internal(&e),
    }
}

async fn get_council_template(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::get_council_template(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Council template not found"),
        Err(e) => err_internal(&e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCouncilTemplateRequest {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    members: serde_json::Value,
    facilitator_profile: Option<String>,
    #[serde(default = "default_deliberation_strategy")]
    deliberation_strategy: String,
    #[serde(default = "default_voting_strategy")]
    voting_strategy: String,
    #[serde(default = "default_max_rounds")]
    max_rounds: i32,
}

fn default_deliberation_strategy() -> String {
    "rounds".to_string()
}
fn default_voting_strategy() -> String {
    "facilitator_judgment".to_string()
}
fn default_max_rounds() -> i32 {
    3
}

async fn create_council_template(
    State(state): State<AppState>,
    Json(body): Json<CreateCouncilTemplateRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match agents::create_council_template(
        pool,
        &id,
        &body.name,
        &body.description,
        &body.members,
        body.facilitator_profile.as_deref(),
        &body.deliberation_strategy,
        &body.voting_strategy,
        body.max_rounds,
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => err_internal(&e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCouncilTemplateRequest {
    name: Option<String>,
    description: Option<String>,
    members: Option<serde_json::Value>,
    deliberation_strategy: Option<String>,
    voting_strategy: Option<String>,
    max_rounds: Option<i32>,
}

async fn update_council_template(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateCouncilTemplateRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::update_council_template(
        pool,
        &id,
        body.name.as_deref(),
        body.description.as_deref(),
        body.members.as_ref(),
        body.deliberation_strategy.as_deref(),
        body.voting_strategy.as_deref(),
        body.max_rounds,
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Council template not found or is builtin"),
        Err(e) => err_internal(&e),
    }
}

async fn delete_council_template(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match agents::delete_council_template(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Council template not found or is builtin"),
        Err(e) => err_internal(&e),
    }
}

// ── Council Run Handlers ────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConveneCouncilRequest {
    template_id: String,
    topic: String,
    context: Option<String>,
    #[serde(default = "default_token_budget")]
    token_budget: i32,
    #[serde(default = "default_max_rounds")]
    max_rounds: i32,
}

async fn convene_council(
    State(state): State<AppState>,
    Json(body): Json<ConveneCouncilRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match agents::create_council_run(
        pool,
        &id,
        &body.template_id,
        &body.topic,
        body.context.as_deref(),
        body.token_budget,
        body.max_rounds,
    )
    .await
    {
        Ok(row) => {
            // Fire-and-forget: transition to running asynchronously.
            let pool = pool.clone();
            let run_id = id.clone();
            let template_id = body.template_id.clone();
            let topic = body.topic.clone();
            let context = body.context.clone();
            let token_budget = body.token_budget as u32;
            let max_rounds = body.max_rounds as u32;
            tokio::spawn(async move {
                let _ = agents::start_council_run(&pool, &run_id).await;

                match agents::get_council_template(&pool, &template_id).await {
                    Ok(Some(template)) => {
                        let delegate = crate::orchestration::hoosh::HooshDelegate::from_env();
                        let executor = crate::orchestration::council::CouncilExecutor::new(
                            delegate,
                            pool.clone(),
                        );
                        match executor
                            .execute(
                                &run_id,
                                &template,
                                &topic,
                                context.as_deref(),
                                token_budget,
                                max_rounds,
                            )
                            .await
                        {
                            Ok(result) => {
                                tracing::info!(run_id = %run_id, consensus = result.consensus, rounds = result.rounds_completed, "council completed")
                            }
                            Err(e) => {
                                let _ = sqlx::query("UPDATE agents.council_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2")
                                    .bind(e.to_string()).bind(&run_id).execute(&pool).await;
                                tracing::error!(run_id = %run_id, error = %e, "council failed");
                            }
                        }
                    }
                    _ => tracing::error!(run_id = %run_id, "council template not found"),
                }
            });
            (
                StatusCode::CREATED,
                Json(serde_json::to_value(row).unwrap()),
            )
                .into_response()
        }
        Err(e) => err_internal(&e),
    }
}

async fn list_council_runs(
    State(state): State<AppState>,
    Query(q): Query<StatusPaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::list_council_runs(pool, q.status.as_deref(), q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => err_internal(&e),
    }
}

async fn get_council_run(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::get_council_run(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Council run not found"),
        Err(e) => err_internal(&e),
    }
}

async fn cancel_council_run(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match agents::cancel_council_run(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Council run not found or not active"),
        Err(e) => err_internal(&e),
    }
}

// ── Team Handlers ───────────────────────────────────────────────────────────

async fn list_teams(
    State(state): State<AppState>,
    Query(q): Query<PaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::list_teams(pool, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => err_internal(&e),
    }
}

async fn get_team(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::get_team(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Team not found"),
        Err(e) => err_internal(&e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTeamRequest {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    members: serde_json::Value,
}

async fn create_team(
    State(state): State<AppState>,
    Json(body): Json<CreateTeamRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match agents::create_team(pool, &id, &body.name, &body.description, &body.members).await {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => err_internal(&e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTeamRequest {
    name: Option<String>,
    description: Option<String>,
    members: Option<serde_json::Value>,
}

async fn update_team(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateTeamRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::update_team(
        pool,
        &id,
        body.name.as_deref(),
        body.description.as_deref(),
        body.members.as_ref(),
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Team not found or is builtin"),
        Err(e) => err_internal(&e),
    }
}

async fn delete_team(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match agents::delete_team(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Team not found or is builtin"),
        Err(e) => err_internal(&e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunTeamRequest {
    task: String,
    context: Option<String>,
    #[serde(default = "default_token_budget")]
    token_budget: i32,
}

async fn run_team(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<RunTeamRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    let run_id = uuid::Uuid::now_v7().to_string();
    match agents::create_team_run(
        pool,
        &run_id,
        &id,
        &body.task,
        body.context.as_deref(),
        body.token_budget,
    )
    .await
    {
        Ok(row) => {
            // Fire-and-forget: transition to running asynchronously.
            let pool = pool.clone();
            let spawn_run_id = run_id.clone();
            let team_id = id.clone();
            let task = body.task.clone();
            let context = body.context.clone();
            let token_budget = body.token_budget as u32;
            tokio::spawn(async move {
                let _ = agents::start_team_run(&pool, &spawn_run_id).await;

                match agents::get_team(&pool, &team_id).await {
                    Ok(Some(team)) => {
                        let delegate = crate::orchestration::hoosh::HooshDelegate::from_env();
                        let executor =
                            crate::orchestration::team::TeamExecutor::new(delegate, pool.clone());
                        match executor
                            .execute(
                                &spawn_run_id,
                                &team,
                                &task,
                                context.as_deref(),
                                token_budget,
                            )
                            .await
                        {
                            Ok(result) => {
                                tracing::info!(run_id = %spawn_run_id, assigned = ?result.assigned_to, "team completed")
                            }
                            Err(e) => {
                                let _ = sqlx::query("UPDATE agents.team_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2")
                                    .bind(e.to_string()).bind(&spawn_run_id).execute(&pool).await;
                                tracing::error!(run_id = %spawn_run_id, error = %e, "team failed");
                            }
                        }
                    }
                    _ => tracing::error!(run_id = %spawn_run_id, "team not found"),
                }
            });
            (
                StatusCode::ACCEPTED,
                Json(serde_json::to_value(row).unwrap()),
            )
                .into_response()
        }
        Err(e) => err_internal(&e),
    }
}

async fn get_team_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::get_team_run(pool, &run_id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Team run not found"),
        Err(e) => err_internal(&e),
    }
}

// ── Profile Skills Handlers ─────────────────────────────────────────────────

async fn list_profile_skills(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::list_profile_skills(pool, &id).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => err_internal(&e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddSkillRequest {
    skill_id: String,
}

async fn add_profile_skill(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<AddSkillRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return err_unavailable();
    };
    match agents::add_profile_skill(pool, &id, &body.skill_id).await {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => err_internal(&e),
    }
}

#[derive(Deserialize)]
struct ProfileSkillPath {
    #[serde(rename = "profileId")]
    profile_id: String,
    #[serde(rename = "skillId")]
    skill_id: String,
}

async fn remove_profile_skill(
    State(state): State<AppState>,
    Path(p): Path<ProfileSkillPath>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match agents::remove_profile_skill(pool, &p.profile_id, &p.skill_id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Skill not found on profile"),
        Err(e) => err_internal(&e),
    }
}

// ── Shared query types & helpers ────────────────────────────────────────────

#[derive(Deserialize)]
struct PaginationQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

#[derive(Deserialize)]
struct StatusPaginationQuery {
    status: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn err_unavailable() -> axum::response::Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    )
        .into_response()
}

fn err_internal(e: &dyn std::fmt::Display) -> axum::response::Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"error": e.to_string()})),
    )
        .into_response()
}

fn not_found(msg: &str) -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"error": msg})),
    )
        .into_response()
}
