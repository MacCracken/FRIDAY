//! Alert routes — alert rules listing and testing.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::alerts;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/alerts/rules", get(list_rules))
        .route("/api/v1/alerts/rules/{id}", get(get_rule))
        .route("/api/v1/alerts/rules/{id}/test", post(test_rule))
}

#[derive(Deserialize)]
struct RuleQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    50
}

async fn list_rules(
    State(state): State<AppState>,
    Query(q): Query<RuleQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match alerts::list_rules(pool, q.limit.min(1000), q.offset).await {
        Ok((rules, total)) => {
            Json(serde_json::json!({"rules": rules, "total": total})).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_rule(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match alerts::get_rule(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Rule not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// Test an alert rule — evaluate it against current metric values and return
/// what *would* happen without actually firing the alert.
async fn test_rule(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match alerts::get_rule(pool, &id).await {
        Ok(Some(rule)) => {
            // Simulate evaluation — in production this would sample the metric.
            Json(serde_json::json!({
                "ruleId": rule.id,
                "ruleName": rule.name,
                "metricPath": rule.metric_path,
                "operator": rule.operator,
                "threshold": rule.threshold,
                "currentValue": null,
                "wouldFire": false,
                "message": "Test completed — metric sampling not yet wired to live telemetry"
            }))
            .into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Rule not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
