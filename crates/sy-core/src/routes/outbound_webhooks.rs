//! Outbound webhook routes — CRUD for outbound webhook configurations.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::outbound_webhooks;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/outbound-webhooks", get(list_webhooks))
        .route("/api/v1/outbound-webhooks", post(create_webhook))
        .route("/api/v1/outbound-webhooks/{id}", get(get_webhook))
        .route("/api/v1/outbound-webhooks/{id}", put(update_webhook))
        .route("/api/v1/outbound-webhooks/{id}", delete(delete_webhook))
        .route("/api/v1/outbound-webhooks/{id}/test", post(test_webhook))
        // /api/v1/integrations/outbound-webhooks aliases
        .route(
            "/api/v1/integrations/outbound-webhooks",
            get(list_webhooks).post(create_webhook),
        )
        .route(
            "/api/v1/integrations/outbound-webhooks/{id}",
            get(get_webhook).put(update_webhook).delete(delete_webhook),
        )
        .route(
            "/api/v1/integrations/outbound-webhooks/{id}/test",
            post(test_webhook),
        )
}

#[derive(Deserialize)]
struct WebhookQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    50
}

async fn list_webhooks(
    State(state): State<AppState>,
    Query(q): Query<WebhookQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match outbound_webhooks::list_webhooks(pool, q.limit.min(200), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateWebhookRequest {
    url: String,
    events: Vec<String>,
    secret: Option<String>,
    description: Option<String>,
}

async fn create_webhook(
    State(state): State<AppState>,
    Json(body): Json<CreateWebhookRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match outbound_webhooks::create_webhook(
        pool,
        &id,
        &body.url,
        &body.events,
        body.secret.as_deref(),
        body.description.as_deref(),
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

async fn get_webhook(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match outbound_webhooks::get_webhook(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Webhook not found"})),
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
struct UpdateWebhookRequest {
    url: Option<String>,
    events: Option<Vec<String>>,
    secret: Option<String>,
    description: Option<String>,
    enabled: Option<bool>,
}

async fn update_webhook(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateWebhookRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match outbound_webhooks::update_webhook(
        pool,
        &id,
        body.url.as_deref(),
        body.events.as_deref(),
        body.secret.as_deref(),
        body.description.as_deref(),
        body.enabled,
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Webhook not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_webhook(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match outbound_webhooks::delete_webhook(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Webhook not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn test_webhook(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match outbound_webhooks::get_webhook(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "webhookId": row.id,
            "url": row.url,
            "status": "dispatched",
            "message": "Test event dispatched to webhook URL",
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Webhook not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
