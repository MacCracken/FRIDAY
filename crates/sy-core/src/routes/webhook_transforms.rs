//! Webhook transform routes — CRUD for webhook payload transformations.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::webhook_transforms;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/webhook-transforms", get(list_transforms))
        .route("/api/v1/webhook-transforms", post(create_transform))
        .route("/api/v1/webhook-transforms/{id}", get(get_transform))
        .route("/api/v1/webhook-transforms/{id}", put(update_transform))
        .route("/api/v1/webhook-transforms/{id}", delete(delete_transform))
        // /api/v1/integrations/webhook-transforms aliases
        .route(
            "/api/v1/integrations/webhook-transforms",
            get(list_transforms).post(create_transform),
        )
        .route(
            "/api/v1/integrations/webhook-transforms/{id}",
            get(get_transform)
                .put(update_transform)
                .delete(delete_transform),
        )
}

#[derive(Deserialize)]
struct TransformQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    50
}

async fn list_transforms(
    State(state): State<AppState>,
    Query(q): Query<TransformQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match webhook_transforms::list_transforms(pool, q.limit.min(200), q.offset).await {
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
struct CreateTransformRequest {
    name: String,
    source_event: String,
    template: serde_json::Value,
    description: Option<String>,
}

async fn create_transform(
    State(state): State<AppState>,
    Json(body): Json<CreateTransformRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match webhook_transforms::create_transform(
        pool,
        &id,
        &body.name,
        &body.source_event,
        &body.template,
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

async fn get_transform(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match webhook_transforms::get_transform(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Transform not found"})),
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
struct UpdateTransformRequest {
    name: Option<String>,
    source_event: Option<String>,
    template: Option<serde_json::Value>,
    description: Option<String>,
    enabled: Option<bool>,
}

async fn update_transform(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateTransformRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match webhook_transforms::update_transform(
        pool,
        &id,
        body.name.as_deref(),
        body.source_event.as_deref(),
        body.template.as_ref(),
        body.description.as_deref(),
        body.enabled,
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Transform not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_transform(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match webhook_transforms::delete_transform(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Transform not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
