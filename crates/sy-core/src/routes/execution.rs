//! Execution routes.
use crate::db::execution;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
pub fn router() -> Router<AppState> {
    Router::new().route("/api/v1/execution/history", get(list_executions))
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
async fn list_executions(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match execution::list_executions(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
