//! Analytics routes — conversation summaries and sentiment.

use crate::db::analytics;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/analytics/summaries", get(list_summaries))
        .route(
            "/api/v1/analytics/conversations/{id}/sentiments",
            get(list_sentiments),
        )
        // Dashboard health widgets
        .route("/api/v1/metrics", get(system_metrics))
        .route("/api/v1/costs/breakdown", get(costs_breakdown))
}

async fn system_metrics(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "uptime": state.uptime_seconds(),
        "version": state.version(),
        "database": state.db().is_some(),
        "requestsTotal": 0,
        "activeConnections": 0,
        "memoryUsageMb": 0,
    }))
}

async fn costs_breakdown(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "totalCost": 0.0,
        "providers": [],
        "period": "current_month",
    }))
}

#[derive(Deserialize)]
struct PQ {
    #[serde(default = "dl")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}
fn dl() -> i64 {
    20
}

async fn list_summaries(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match analytics::list_summaries(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_sentiments(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match analytics::list_sentiments(pool, &id).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
