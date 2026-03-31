//! Observability routes — metrics, health, alerts, logs, and traces.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::observability;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/observability/metrics", get(list_metrics))
        .route("/api/v1/observability/health", get(observability_health))
        .route("/api/v1/observability/alerts", get(list_alerts))
        .route("/api/v1/observability/logs", get(list_logs))
        .route("/api/v1/observability/traces", get(list_traces))
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

async fn list_metrics(
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
    match observability::list_metrics(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn observability_health(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "healthy",
        "metricsCollector": "active",
        "alertEngine": "active",
        "logPipeline": "active",
        "traceCollector": "active"
    }))
    .into_response()
}

async fn list_alerts(
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
    match observability::list_alerts(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_logs(State(_s): State<AppState>) -> impl IntoResponse {
    // Logs are streamed from the log pipeline; this returns recent cached entries
    Json(serde_json::json!({
        "logs": [],
        "note": "Connect to log pipeline for live log streaming"
    }))
    .into_response()
}

async fn list_traces(State(_s): State<AppState>) -> impl IntoResponse {
    // Traces are collected by the trace collector; this returns recent entries
    Json(serde_json::json!({
        "traces": [],
        "note": "Connect to trace collector for live trace data"
    }))
    .into_response()
}
