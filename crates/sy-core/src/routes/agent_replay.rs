//! Agent replay routes — trace inspection and replay.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::agent_replay;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/agent-replay/traces", get(list_traces))
        .route("/api/v1/agent-replay/traces/{id}", get(get_trace))
        .route("/api/v1/agent-replay/traces/{id}/chain", get(get_chain))
        .route(
            "/api/v1/agent-replay/traces/{id}/replay",
            post(replay_trace),
        )
        .route("/api/v1/agent-replay/traces/{id}/summary", get(get_summary))
        .route("/api/v1/agent-replay/diff", post(diff_traces))
}

#[derive(Deserialize)]
struct PaginationQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

async fn list_traces(
    State(state): State<AppState>,
    Query(q): Query<PaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agent_replay::list_traces(pool, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_trace(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agent_replay::get_trace(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Trace not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/agent-replay/traces/{id}/chain — get the full chain of a trace.
async fn get_chain(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agent_replay::get_trace(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "traceId": row.id,
            "chain": row.chain_json,
            "depth": row.depth,
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Trace not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/v1/agent-replay/traces/{id}/replay — replay a trace.
async fn replay_trace(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agent_replay::get_trace(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "traceId": row.id,
            "status": "replaying",
            "message": "Replay initiated",
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Trace not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/agent-replay/traces/{id}/summary — trace summary.
async fn get_summary(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match agent_replay::get_trace(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "traceId": row.id,
            "agentId": row.agent_id,
            "status": row.status,
            "depth": row.depth,
            "durationMs": row.duration_ms,
            "createdAt": row.created_at,
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Trace not found"})),
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
struct DiffRequest {
    trace_a: String,
    trace_b: String,
}

/// POST /api/v1/agent-replay/diff — diff two traces.
async fn diff_traces(
    State(state): State<AppState>,
    Json(body): Json<DiffRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let a = agent_replay::get_trace(pool, &body.trace_a).await;
    let b = agent_replay::get_trace(pool, &body.trace_b).await;
    match (a, b) {
        (Ok(Some(ta)), Ok(Some(tb))) => Json(serde_json::json!({
            "traceA": ta.id,
            "traceB": tb.id,
            "depthDiff": (ta.depth as i64) - (tb.depth as i64),
            "durationDiff": ta.duration_ms.unwrap_or(0) - tb.duration_ms.unwrap_or(0),
        }))
        .into_response(),
        (Ok(None), _) | (_, Ok(None)) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "One or both traces not found"})),
        )
            .into_response(),
        (Err(e), _) | (_, Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
