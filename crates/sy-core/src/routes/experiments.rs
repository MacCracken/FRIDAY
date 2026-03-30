//! Experiment routes.
use crate::db::experiments;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
pub fn router() -> Router<AppState> {
    Router::new().route("/api/v1/experiments", get(list_experiments))
}
#[derive(Deserialize)]
struct LQ {
    #[serde(default = "dl")]
    limit: i64,
}
fn dl() -> i64 {
    20
}
async fn list_experiments(State(s): State<AppState>, Query(q): Query<LQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match experiments::list_experiments(pool, q.limit.min(100)).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
