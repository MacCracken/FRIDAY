//! Brain routes — memory and knowledge CRUD.
//!
//! Mirrors the TS `brain/brain-routes.ts` endpoints.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::brain;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // Memories
        .route("/api/v1/brain/memories", post(create_memory))
        .route("/api/v1/brain/memories", get(list_memories))
        .route("/api/v1/brain/memories/{id}", get(get_memory))
        .route("/api/v1/brain/memories/{id}", delete(delete_memory))
        // Knowledge
        .route("/api/v1/brain/knowledge", post(create_knowledge))
        .route("/api/v1/brain/knowledge", get(query_knowledge))
        .route("/api/v1/brain/knowledge/{id}", delete(delete_knowledge))
        // Stats
        .route("/api/v1/brain/stats", get(get_stats))
}

// ── Memory handlers ────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateMemoryRequest {
    r#type: String,
    content: String,
    source: String,
    #[serde(default)]
    context: serde_json::Value,
    #[serde(default = "default_importance")]
    importance: f64,
    personality_id: Option<String>,
}

fn default_importance() -> f64 {
    0.5
}

async fn create_memory(
    State(state): State<AppState>,
    Json(body): Json<CreateMemoryRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match brain::insert_memory(
        pool,
        &id,
        &body.r#type,
        &body.content,
        &body.source,
        &body.context,
        body.importance,
        body.personality_id.as_deref(),
        "default",
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
struct ListMemoriesQuery {
    r#type: Option<String>,
    personality_id: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

async fn list_memories(
    State(state): State<AppState>,
    Query(q): Query<ListMemoriesQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match brain::list_memories(
        pool,
        "default",
        q.r#type.as_deref(),
        q.personality_id.as_deref(),
        q.limit.min(1000),
        q.offset,
    )
    .await
    {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_memory(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match brain::get_memory(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Memory not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_memory(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match brain::delete_memory(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Memory not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Knowledge handlers ─────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateKnowledgeRequest {
    topic: String,
    content: String,
    source: String,
    #[serde(default = "default_confidence")]
    confidence: f64,
    personality_id: Option<String>,
}

fn default_confidence() -> f64 {
    0.8
}

async fn create_knowledge(
    State(state): State<AppState>,
    Json(body): Json<CreateKnowledgeRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match brain::insert_knowledge(
        pool,
        &id,
        &body.topic,
        &body.content,
        &body.source,
        body.confidence,
        body.personality_id.as_deref(),
        "default",
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
struct QueryKnowledgeParams {
    q: Option<String>,
    personality_id: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}

async fn query_knowledge(
    State(state): State<AppState>,
    Query(q): Query<QueryKnowledgeParams>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let query_text = q.q.as_deref().unwrap_or("");
    match brain::query_knowledge(
        pool,
        "default",
        query_text,
        q.personality_id.as_deref(),
        q.limit.min(100),
    )
    .await
    {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_knowledge(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match brain::delete_knowledge(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Knowledge not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Stats ──────────────────────────────────────────────────────────────────

async fn get_stats(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match brain::get_stats(pool, "default").await {
        Ok(stats) => Json(serde_json::to_value(stats).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
