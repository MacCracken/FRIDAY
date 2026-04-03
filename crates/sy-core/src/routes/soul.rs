//! Soul routes — personality CRUD.
//!
//! Mirrors the TS `soul/soul-routes.ts` personality endpoints.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::soul;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/soul/personalities", get(list_personalities))
        .route("/api/v1/soul/personalities", post(create_personality))
        .route("/api/v1/soul/personalities/active", get(get_active))
        .route("/api/v1/soul/personalities/{id}", get(get_personality))
        .route("/api/v1/soul/personalities/{id}", put(update_personality))
        .route(
            "/api/v1/soul/personalities/{id}",
            delete(delete_personality),
        )
        .route(
            "/api/v1/soul/personalities/{id}/activate",
            put(activate_personality),
        )
        .route(
            "/api/v1/soul/personalities/{id}/disable",
            post(disable_personality),
        )
        .route("/api/v1/soul/config", get(get_soul_config))
        .route("/api/v1/soul/onboarding/status", get(get_onboarding_status))
        .route(
            "/api/v1/soul/onboarding/complete",
            post(complete_onboarding),
        )
        .route("/api/v1/soul/skills", get(list_skills))
        .route("/api/v1/soul/skills", post(create_skill))
        .route("/api/v1/soul/skills/{id}", delete(delete_skill))
        // Dashboard expects these additional soul endpoints
        .route("/api/v1/soul/agent-name", get(get_agent_name))
        .route("/api/v1/soul/agent-name", put(set_agent_name))
        .route("/api/v1/soul/personality", get(get_active_personality))
        .route("/api/v1/soul/strategies", get(list_strategies))
        .route(
            "/api/v1/soul/personalities/clear-default",
            post(clear_default_personality),
        )
}

async fn list_personalities(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match soul::list_personalities(pool, "default").await {
        Ok(rows) => Json(serde_json::json!({"personalities": rows})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePersonalityRequest {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    system_prompt: String,
    #[serde(default = "default_traits")]
    traits: serde_json::Value,
}

fn default_traits() -> serde_json::Value {
    serde_json::json!({})
}

async fn create_personality(
    State(state): State<AppState>,
    Json(body): Json<CreatePersonalityRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match soul::create_personality(
        pool,
        &id,
        &body.name,
        &body.description,
        &body.system_prompt,
        &body.traits,
        "default",
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
#[serde(rename_all = "camelCase")]
struct UpdatePersonalityRequest {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    system_prompt: String,
    #[serde(default = "default_traits")]
    traits: serde_json::Value,
    // Accept the full body blob — includes mcpFeatures, activeHours, capabilities, etc.
    #[serde(default)]
    body: Option<serde_json::Value>,
    #[serde(default)]
    voice: Option<String>,
    #[serde(default)]
    sex: Option<String>,
    #[serde(default)]
    preferred_language: Option<String>,
    #[serde(default)]
    include_archetypes: Option<bool>,
    #[serde(default)]
    inject_date_time: Option<bool>,
    #[serde(default)]
    empathy_resonance: Option<bool>,
    #[serde(default)]
    brain_config: Option<serde_json::Value>,
    #[serde(default)]
    default_model: Option<serde_json::Value>,
}

async fn update_personality(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdatePersonalityRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match soul::update_personality(
        pool,
        &id,
        &body.name,
        &body.description,
        &body.system_prompt,
        &body.traits,
        body.body.as_ref(),
        body.voice.as_deref(),
        body.sex.as_deref(),
        body.include_archetypes,
        body.default_model.as_ref(),
        "default",
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::json!({"personality": row})).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Personality not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_personality(
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
    match soul::get_personality(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Personality not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_active(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match soul::get_active_personality(pool, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No active personality"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn activate_personality(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match soul::activate_personality(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Personality not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn disable_personality(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match soul::disable_personality(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Personality not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_personality(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match soul::delete_personality(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Personality not found or is default"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_soul_config(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let active = soul::get_active_personality(pool, "default").await;
    let all = soul::list_personalities(pool, "default").await;
    match (active, all) {
        (Ok(active_row), Ok(rows)) => Json(serde_json::json!({
            "activePersonalityId": active_row.map(|r| r.id),
            "totalCount": rows.len(),
        }))
        .into_response(),
        (Err(e), _) | (_, Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_onboarding_status(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    // Onboarding is considered complete if at least one non-default personality exists
    match soul::list_personalities(pool, "default").await {
        Ok(rows) => {
            let completed = rows.iter().any(|r| !r.is_default);
            Json(serde_json::json!({"completed": completed})).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn complete_onboarding(State(state): State<AppState>) -> impl IntoResponse {
    let Some(_pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    // Mark onboarding as complete — currently a no-op acknowledgement
    StatusCode::NO_CONTENT.into_response()
}

async fn list_skills(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    // Get the active personality to list its skills
    let active = match soul::get_active_personality(pool, "default").await {
        Ok(Some(row)) => row,
        Ok(None) => {
            return Json(serde_json::json!([])).into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    };
    match soul::list_skills(pool, &active.id, "default").await {
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
struct CreateSkillRequest {
    name: String,
    #[serde(default)]
    description: String,
    personality_id: String,
    #[serde(default = "default_skill_config")]
    config: serde_json::Value,
}

fn default_skill_config() -> serde_json::Value {
    serde_json::json!({})
}

async fn create_skill(
    State(state): State<AppState>,
    Json(body): Json<CreateSkillRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match soul::create_skill(
        pool,
        &id,
        &body.name,
        &body.description,
        &body.personality_id,
        &body.config,
        "default",
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

async fn delete_skill(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match soul::delete_skill(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Skill not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Agent Name ─────────────────────────────────────────────────────────

async fn get_agent_name(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return Json(serde_json::json!({"name": "FRIDAY"})).into_response();
    };
    let name: String = sqlx::query_scalar(
        "SELECT COALESCE(value, 'FRIDAY') FROM soul.config WHERE key = 'agent_name' LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "FRIDAY".to_string());
    Json(serde_json::json!({"name": name})).into_response()
}

#[derive(Deserialize)]
struct AgentNameRequest {
    name: String,
}

async fn set_agent_name(
    State(state): State<AppState>,
    Json(body): Json<AgentNameRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let _ = sqlx::query(
        "INSERT INTO soul.config (key, value) VALUES ('agent_name', $1) \
         ON CONFLICT (key) DO UPDATE SET value = $1",
    )
    .bind(&body.name)
    .execute(pool)
    .await;
    Json(serde_json::json!({"name": body.name})).into_response()
}

// ── Active Personality Shortcut ────────────────────────────────────────

async fn get_active_personality(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match soul::get_active_personality(pool, "default").await {
        Ok(Some(p)) => Json(serde_json::json!({"personality": p})).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No active personality"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Strategies ─────────────────────────────────────────────────────────

async fn list_strategies() -> impl IntoResponse {
    Json(serde_json::json!({
        "strategies": [
            {"id": "balanced", "name": "Balanced", "description": "Default balanced reasoning", "isDefault": true},
            {"id": "analytical", "name": "Analytical", "description": "Step-by-step logical analysis", "isDefault": false},
            {"id": "creative", "name": "Creative", "description": "Open-ended creative exploration", "isDefault": false},
            {"id": "concise", "name": "Concise", "description": "Brief, direct responses", "isDefault": false},
        ]
    }))
}

// ── Clear Default Personality ──────────────────────────────────────────

async fn clear_default_personality(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let _ =
        sqlx::query("UPDATE soul.personalities SET is_default = false WHERE tenant_id = 'default'")
            .execute(pool)
            .await;
    StatusCode::NO_CONTENT.into_response()
}
