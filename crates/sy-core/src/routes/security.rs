//! Security routes — DLP policies, SRA assessments.

use crate::db::security;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/security/dlp/policies", get(list_dlp_policies))
        .route(
            "/api/v1/security/sra/assessments",
            get(list_sra_assessments),
        )
}

async fn list_dlp_policies(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::list_dlp_policies(pool).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct LimitQuery {
    #[serde(default = "dl")]
    limit: i64,
}
fn dl() -> i64 {
    20
}

async fn list_sra_assessments(
    State(s): State<AppState>,
    Query(q): Query<LimitQuery>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::list_sra_assessments(pool, q.limit.min(100)).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
