//! A2A routes — agent-to-agent peer management.

use crate::db::a2a;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/a2a/peers", get(list_peers))
        .route("/api/v1/a2a/peers/{id}", get(get_peer))
}

#[derive(Deserialize)]
struct PaginationQuery {
    #[serde(default = "dl")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}
fn dl() -> i64 {
    20
}

async fn list_peers(
    State(s): State<AppState>,
    Query(q): Query<PaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match a2a::list_peers(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_peer(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match a2a::get_peer(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error":"Peer not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
