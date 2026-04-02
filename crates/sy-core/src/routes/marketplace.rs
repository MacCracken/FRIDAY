//! Marketplace routes — community skill browsing.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::marketplace;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/marketplace/skills", get(list_skills))
        .route("/api/v1/marketplace/skills/{id}", get(get_skill))
        .route("/api/v1/marketplace/{id}", get(get_marketplace_item))
        .route("/api/v1/marketplace/{id}/install", post(install_item))
        .route("/api/v1/marketplace/{id}/uninstall", post(uninstall_item))
        .route("/api/v1/marketplace/publish", post(publish_item))
        .route(
            "/api/v1/marketplace/community/status",
            get(community_status),
        )
        .route("/api/v1/marketplace/community/sync", post(community_sync))
        .route("/api/v1/marketplace", get(list_marketplace))
        .route(
            "/api/v1/marketplace/community/personalities",
            get(list_community_personalities),
        )
        .route(
            "/api/v1/marketplace/community/personalities/install",
            post(install_community_personality),
        )
        .route(
            "/api/v1/marketplace/community/personalities/avatar/{path}",
            get(community_personality_avatar),
        )
}

#[derive(Deserialize)]
struct SkillQuery {
    category: Option<String>,
    installed: Option<bool>,
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

async fn list_skills(
    State(state): State<AppState>,
    Query(q): Query<SkillQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match marketplace::list_skills(
        pool,
        q.category.as_deref(),
        q.installed,
        q.limit.min(100),
        q.offset,
    )
    .await
    {
        Ok(rows) => Json(serde_json::json!({"skills": rows, "total": rows.len()})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_skill(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match marketplace::get_skill(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
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

async fn get_marketplace_item(
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
    match marketplace::get_marketplace_item(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Item not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn install_item(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match marketplace::install_item(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Item not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn uninstall_item(
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
    match marketplace::uninstall_item(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Item not found"})),
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
struct PublishRequest {
    name: String,
    description: Option<String>,
    version: Option<String>,
    category: Option<String>,
    #[serde(default = "empty_tools")]
    tools: serde_json::Value,
    instructions: Option<String>,
}
fn empty_tools() -> serde_json::Value {
    serde_json::json!([])
}

async fn publish_item(
    State(state): State<AppState>,
    Json(body): Json<PublishRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match marketplace::publish_item(
        pool,
        &id,
        &body.name,
        body.description.as_deref(),
        body.version.as_deref(),
        body.category.as_deref(),
        &body.tools,
        body.instructions.as_deref(),
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

async fn community_status(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match marketplace::get_community_sync_status(pool).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => Json(serde_json::json!({"status": "never_synced"})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_marketplace(
    State(state): State<AppState>,
    Query(q): Query<SkillQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match marketplace::list_skills(
        pool,
        q.category.as_deref(),
        q.installed,
        q.limit.min(100),
        q.offset,
    )
    .await
    {
        Ok(rows) => Json(serde_json::json!({"skills": rows, "total": rows.len()})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_community_personalities(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match marketplace::list_community_personalities(pool).await {
        Ok(rows) => {
            Json(serde_json::json!({"personalities": rows, "total": rows.len()})).into_response()
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
struct InstallPersonalityRequest {
    personality_id: String,
}

async fn install_community_personality(
    State(state): State<AppState>,
    Json(body): Json<InstallPersonalityRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match marketplace::install_community_personality(pool, &body.personality_id).await {
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

/// GET /api/v1/marketplace/community/personalities/avatar/{path} — serve personality avatar.
async fn community_personality_avatar(Path(path): Path<String>) -> impl IntoResponse {
    // In production this would serve the avatar file from storage.
    // For now return a placeholder response.
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "path": path,
            "contentType": "image/png",
            "message": "Avatar storage not yet connected",
        })),
    )
        .into_response()
}

async fn community_sync(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match marketplace::trigger_community_sync(pool).await {
        Ok(row) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
