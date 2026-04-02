//! Desktop routes — session management and screen capture.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::desktop;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/desktop/status", get(desktop_status))
        .route("/api/v1/desktop/recording/active", get(active_recordings))
        .route("/api/v1/desktop/recording/stop", post(stop_recording))
        .route("/api/v1/desktop/windows", get(list_windows))
        .route("/api/v1/desktop/capture", post(capture_screen))
        .route("/api/v1/desktop/sessions", get(list_sessions))
        .route("/api/v1/desktop/sessions/{id}", get(get_session))
        .route("/api/v1/desktop/sessions", post(create_session))
        .route("/api/v1/desktop/sessions/{id}", delete(end_session))
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

async fn desktop_status(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "available": true,
        "backend": "sy-desktop",
        "capabilities": {
            "capture": true,
            "windowManagement": true,
            "sessionRecording": true
        }
    }))
    .into_response()
}

async fn list_windows(State(_s): State<AppState>) -> impl IntoResponse {
    // Window listing is a runtime operation, returns empty when not connected
    Json(serde_json::json!({
        "windows": [],
        "note": "Connect via desktop agent for live window list"
    }))
    .into_response()
}

async fn capture_screen(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "captureId": uuid::Uuid::now_v7().to_string(),
        "status": "queued",
        "note": "Screen capture delegated to desktop agent"
    }))
    .into_response()
}

async fn list_sessions(
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
    match desktop::list_sessions(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_session(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match desktop::get_session(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Session not found"})),
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
struct CreateSessionRequest {
    name: Option<String>,
    resolution: Option<String>,
}

async fn create_session(
    State(state): State<AppState>,
    Json(body): Json<CreateSessionRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match desktop::create_session(
        pool,
        &id,
        "default",
        body.name.as_deref(),
        body.resolution.as_deref(),
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

async fn end_session(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match desktop::delete_session(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Session not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn active_recordings() -> impl IntoResponse {
    Json(serde_json::json!({"recordings": []}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StopRecordingRequest {
    session_id: String,
}

async fn stop_recording(Json(body): Json<StopRecordingRequest>) -> impl IntoResponse {
    Json(serde_json::json!({
        "sessionId": body.session_id,
        "status": "stopped",
    }))
}
