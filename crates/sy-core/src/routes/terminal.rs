//! Terminal routes — command execution and environment detection.
//!
//! Delegates to the execution sandbox.  No DB needed.

use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/terminal/execute", post(execute_command))
        .route("/api/v1/terminal/health", get(terminal_health))
        .route("/api/v1/terminal/tech-stack", get(detect_tech_stack))
        .route("/api/v1/terminal/worktrees", get(list_worktrees))
        .route("/api/v1/terminal/worktrees", post(create_worktree))
        .route("/api/v1/terminal/worktrees/{id}", get(get_worktree))
        .route("/api/v1/terminal/worktrees/{id}", delete(delete_worktree))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteRequest {
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
}

/// POST /api/v1/terminal/execute — execute a command in the sandbox.
///
/// In production this would delegate to sy-sandbox for isolation.
/// For now it returns a queued status.
async fn execute_command(Json(body): Json<ExecuteRequest>) -> impl IntoResponse {
    if body.command.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "command is required"})),
        )
            .into_response();
    }
    Json(serde_json::json!({
        "status": "queued",
        "command": body.command,
        "cwd": body.cwd,
        "timeoutMs": body.timeout_ms.unwrap_or(30000),
        "message": "Command queued for sandbox execution",
    }))
    .into_response()
}

async fn terminal_health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "healthy",
        "sandboxAvailable": true,
    }))
    .into_response()
}

/// GET /api/v1/terminal/tech-stack — detect installed tools.
///
/// Placeholder — in production this would probe the sandbox for
/// installed runtimes, compilers, and tools.
async fn detect_tech_stack() -> impl IntoResponse {
    Json(serde_json::json!({
        "detected": [],
        "message": "Tech stack detection not yet connected to sandbox",
    }))
    .into_response()
}

/// GET /api/v1/terminal/worktrees — list git worktrees.
///
/// Placeholder — in production this would run `git worktree list`
/// inside the sandbox.
async fn list_worktrees() -> impl IntoResponse {
    Json(serde_json::json!({
        "worktrees": [],
        "message": "Worktree listing not yet connected to sandbox",
    }))
    .into_response()
}

async fn get_worktree(Path(id): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({
        "id": id,
        "worktree": serde_json::Value::Null,
        "message": "Worktree lookup not yet connected to sandbox",
    }))
    .into_response()
}

#[derive(Deserialize)]
struct CreateWorktreeRequest {
    name: String,
}

/// POST /api/v1/terminal/worktrees — create a new git worktree.
///
/// Placeholder — in production this would run `git worktree add`
/// inside the sandbox and return the new worktree path.
async fn create_worktree(Json(body): Json<CreateWorktreeRequest>) -> impl IntoResponse {
    if body.name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "name is required"})),
        )
            .into_response();
    }
    let id = uuid::Uuid::now_v7().to_string();
    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "name": body.name,
            "message": "Worktree creation not yet connected to sandbox",
            "stub": true,
        })),
    )
        .into_response()
}

/// DELETE /api/v1/terminal/worktrees/{id} — remove a git worktree.
///
/// Placeholder — in production this would run `git worktree remove`
/// inside the sandbox.
async fn delete_worktree(Path(id): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({
        "id": id,
        "removed": false,
        "message": "Worktree removal not yet connected to sandbox",
        "stub": true,
    }))
    .into_response()
}
