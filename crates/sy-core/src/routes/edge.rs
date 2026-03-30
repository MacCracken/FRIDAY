//! Edge routes — fleet node management.

use crate::db::edge;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/edge/nodes", get(list_nodes))
        .route("/api/v1/edge/nodes", post(register_node))
        .route("/api/v1/edge/nodes/{id}", get(get_node))
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

async fn list_nodes(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match edge::list_nodes(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterNodeRequest {
    name: String,
    #[serde(default = "empty_caps")]
    capabilities: serde_json::Value,
}
fn empty_caps() -> serde_json::Value {
    serde_json::json!({})
}

async fn register_node(
    State(s): State<AppState>,
    Json(body): Json<RegisterNodeRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match edge::register_node(pool, &id, &body.name, &body.capabilities).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_node(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match edge::get_node(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error":"Node not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
