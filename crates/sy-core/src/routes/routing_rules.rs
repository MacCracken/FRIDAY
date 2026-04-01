//! Routing rules routes — rule listing, CRUD, and testing.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::routing_rules;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/routing-rules", get(list_rules))
        .route("/api/v1/routing-rules", post(create_rule))
        .route("/api/v1/routing-rules/{id}", get(get_rule))
        .route("/api/v1/routing-rules/{id}", put(update_rule))
        .route("/api/v1/routing-rules/{id}", delete(delete_rule))
        .route("/api/v1/routing-rules/{id}/test", post(test_rule))
        // /api/v1/integrations/routing-rules aliases
        .route(
            "/api/v1/integrations/routing-rules",
            get(list_rules).post(create_rule),
        )
        .route(
            "/api/v1/integrations/routing-rules/{id}",
            get(get_rule).put(update_rule).delete(delete_rule),
        )
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

async fn list_rules(
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
    match routing_rules::list_rules(pool, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
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
    match routing_rules::get_rule(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Routing rule not found"})),
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
struct TestRuleRequest {
    payload: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRuleRequest {
    name: String,
    description: Option<String>,
    #[serde(default = "empty_obj")]
    condition: serde_json::Value,
    #[serde(default = "empty_obj")]
    action: serde_json::Value,
    #[serde(default)]
    priority: i32,
}

fn empty_obj() -> serde_json::Value {
    serde_json::json!({})
}

async fn create_rule(
    State(state): State<AppState>,
    Json(body): Json<CreateRuleRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match routing_rules::create_rule(
        pool,
        &id,
        &body.name,
        body.description.as_deref(),
        &body.condition,
        &body.action,
        body.priority,
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
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
struct UpdateRuleRequest {
    name: Option<String>,
    description: Option<String>,
    condition: Option<serde_json::Value>,
    action: Option<serde_json::Value>,
    priority: Option<i32>,
    enabled: Option<bool>,
}

async fn update_rule(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateRuleRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match routing_rules::update_rule(
        pool,
        &id,
        body.name.as_deref(),
        body.description.as_deref(),
        body.condition.as_ref(),
        body.action.as_ref(),
        body.priority,
        body.enabled,
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Routing rule not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_rule(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match routing_rules::delete_rule(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Routing rule not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn test_rule(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<TestRuleRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match routing_rules::get_rule(pool, &id).await {
        Ok(Some(rule)) => Json(serde_json::json!({
            "ruleId": rule.id,
            "name": rule.name,
            "condition": rule.condition,
            "action": rule.action,
            "testPayload": body.payload,
            "result": "matched",
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Routing rule not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
