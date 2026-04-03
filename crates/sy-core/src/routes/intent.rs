//! Intent routes — pattern management and intent detection.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::intent;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/intent/patterns", get(list_patterns))
        .route("/api/v1/intent/patterns", post(create_pattern))
        .route("/api/v1/intent/patterns/{id}", get(get_pattern))
        .route("/api/v1/intent/patterns/{id}", delete(delete_pattern))
        .route("/api/v1/intent/detect", post(detect_intent))
        .route("/api/v1/intent/config", get(intent_config))
        .route("/api/v1/intent/active", get(active_intent))
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

async fn list_patterns(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match intent::list_patterns(pool, "default", q.limit.min(100), q.offset).await {
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
struct CreatePatternRequest {
    name: String,
    description: Option<String>,
    pattern: String,
    category: Option<String>,
    priority: Option<i32>,
}

async fn create_pattern(
    State(state): State<AppState>,
    Json(body): Json<CreatePatternRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match intent::create_pattern(
        pool,
        &id,
        "default",
        &body.name,
        body.description.as_deref(),
        &body.pattern,
        body.category.as_deref(),
        body.priority,
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

async fn get_pattern(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match intent::get_pattern(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Pattern not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_pattern(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match intent::delete_pattern(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Pattern not found"})),
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
struct DetectRequest {
    text: String,
}

async fn detect_intent(
    State(state): State<AppState>,
    Json(body): Json<DetectRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    // Load patterns and do basic matching
    match intent::list_patterns(pool, "default", 100, 0).await {
        Ok(patterns) => {
            let matches: Vec<_> = patterns
                .iter()
                .filter(|p| p.enabled && body.text.contains(&p.pattern))
                .map(|p| {
                    serde_json::json!({
                        "patternId": p.id,
                        "name": p.name,
                        "category": p.category,
                        "priority": p.priority,
                    })
                })
                .collect();
            Json(serde_json::json!({
                "text": body.text,
                "matches": matches,
                "matchCount": matches.len(),
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

async fn intent_config(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "maxPatterns": 1000,
        "matchingStrategy": "substring",
        "defaultPriority": 0,
        "categories": ["command", "query", "action", "navigation"]
    }))
    .into_response()
}

async fn active_intent(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "active": null,
        "message": "No active intent"
    }))
}
