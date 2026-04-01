//! Model management routes — model info, defaults, routing, Ollama management.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;

use crate::db::models as model_db;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // Model info & config
        .route("/api/v1/model/info", get(get_model_info))
        .route("/api/v1/model/info", patch(update_model_info))
        .route("/api/v1/model/switch", post(switch_model))
        // Default model
        .route("/api/v1/model/default", get(get_default_model))
        .route("/api/v1/model/default", post(set_default_model))
        .route("/api/v1/model/default", delete(clear_default_model))
        // Cost & routing
        .route(
            "/api/v1/model/cost-recommendations",
            get(cost_recommendations),
        )
        .route("/api/v1/model/routing-stats", get(routing_stats))
        .route(
            "/api/v1/model/routing-suggestions",
            get(routing_suggestions),
        )
        .route("/api/v1/model/providers", get(list_providers))
        // Ollama management
        .route("/api/v1/model/ollama/pull", post(ollama_pull))
        .route("/api/v1/model/ollama/list", post(ollama_list))
        .route("/api/v1/model/ollama/{name}", delete(ollama_delete))
        // Health
        .route("/api/v1/model/health", get(model_health))
        .route("/api/v1/ai/health", get(ai_health))
}

#[derive(Deserialize)]
struct OllamaPullRequest {
    model: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OllamaPullProgress {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn ollama_base_url() -> String {
    std::env::var("OLLAMA_HOST").unwrap_or_else(|_| "http://localhost:11434".to_string())
}

/// POST /api/v1/model/ollama/pull — stream Ollama model download progress.
///
/// Proxies to Ollama's POST /api/pull with stream:true, relays NDJSON lines as SSE events.
async fn ollama_pull(
    State(_state): State<AppState>,
    Json(body): Json<OllamaPullRequest>,
) -> impl IntoResponse {
    let base_url = ollama_base_url();
    let url = format!("{base_url}/api/pull");
    let model = body.model;

    // Start the pull request to Ollama
    let client = reqwest::Client::new();
    let response = match client
        .post(&url)
        .json(&serde_json::json!({ "model": model, "stream": true }))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let status = r.status().as_u16();
            let err = r.text().await.unwrap_or_default();
            return (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": format!("Ollama error: {err}")})),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": format!("Failed to connect to Ollama: {e}")})),
            )
                .into_response();
        }
    };

    // Read the full NDJSON response body and stream as SSE events.
    // Ollama pull responses are NDJSON — one JSON object per line.
    // We read the entire body (pull progress is small), split into lines,
    // and emit each as an SSE event.
    let body_text = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": format!("Failed to read Ollama response: {e}")})),
            )
                .into_response();
        }
    };

    let events: Vec<Result<Event, Infallible>> = body_text
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let event = match serde_json::from_str::<OllamaPullProgress>(line) {
                Ok(ref progress) if progress.error.is_some() => Event::default()
                    .event("error")
                    .data(serde_json::to_string(progress).unwrap_or_default()),
                Ok(ref progress) => {
                    Event::default().data(serde_json::to_string(progress).unwrap_or_default())
                }
                Err(_) => Event::default().data(line),
            };
            Ok(event)
        })
        .collect();

    Sse::new(tokio_stream::iter(events))
        .keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(10)))
        .into_response()
}

// ── Model Info ──────────────────────────────────────────────────────────

/// GET /api/v1/model/info — get current active model config.
async fn get_model_info(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match model_db::get_model_info(pool, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => Json(serde_json::json!({
            "provider": "ollama",
            "modelName": "default",
            "isDefault": false,
            "config": {},
        }))
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
struct UpdateModelInfoRequest {
    provider: Option<String>,
    model_name: Option<String>,
    config: Option<serde_json::Value>,
}

/// PATCH /api/v1/model/info — update the active model config.
async fn update_model_info(
    State(state): State<AppState>,
    Json(body): Json<UpdateModelInfoRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    let provider = body.provider.as_deref().unwrap_or("ollama");
    let model_name = body.model_name.as_deref().unwrap_or("default");
    let config = body.config.unwrap_or(serde_json::json!({}));
    match model_db::upsert_model_info(pool, &id, "default", provider, model_name, &config).await {
        Ok(row) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwitchModelRequest {
    provider: String,
    model_name: String,
    config: Option<serde_json::Value>,
}

/// POST /api/v1/model/switch — switch the active model.
async fn switch_model(
    State(state): State<AppState>,
    Json(body): Json<SwitchModelRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    let config = body.config.unwrap_or(serde_json::json!({}));
    match model_db::upsert_model_info(
        pool,
        &id,
        "default",
        &body.provider,
        &body.model_name,
        &config,
    )
    .await
    {
        Ok(row) => Json(serde_json::json!({
            "switched": true,
            "model": serde_json::to_value(row).unwrap(),
        }))
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Default Model ───────────────────────────────────────────────────────

/// GET /api/v1/model/default — get the default model.
async fn get_default_model(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match model_db::get_default_model(pool, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No default model set"})),
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
struct SetDefaultModelRequest {
    provider: String,
    model_name: String,
    config: Option<serde_json::Value>,
}

/// POST /api/v1/model/default — set the default model.
async fn set_default_model(
    State(state): State<AppState>,
    Json(body): Json<SetDefaultModelRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    let config = body.config.unwrap_or(serde_json::json!({}));
    match model_db::set_default_model(
        pool,
        &id,
        "default",
        &body.provider,
        &body.model_name,
        &config,
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

/// DELETE /api/v1/model/default — clear the default model.
async fn clear_default_model(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match model_db::clear_default_model(pool, "default").await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Cost & Routing (placeholder responses — real logic in TS AI client layer) ──

/// GET /api/v1/model/cost-recommendations — cost optimization suggestions.
async fn cost_recommendations(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "recommendations": [],
        "estimatedMonthlySavings": 0.0,
        "currency": "USD",
    }))
}

/// GET /api/v1/model/routing-stats — model routing statistics.
async fn routing_stats(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "totalRequests": 0,
        "byProvider": {},
        "byModel": {},
        "averageLatencyMs": 0,
    }))
}

/// GET /api/v1/model/routing-suggestions — routing optimization suggestions.
async fn routing_suggestions(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "suggestions": [],
    }))
}

/// GET /api/v1/model/providers — list available AI providers.
async fn list_providers(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "providers": [
            {"id": "ollama", "name": "Ollama", "status": "available"},
            {"id": "openai", "name": "OpenAI", "status": "available"},
            {"id": "anthropic", "name": "Anthropic", "status": "available"},
        ],
    }))
}

// ── Ollama — List & Delete ──────────────────────────────────────────────

/// POST /api/v1/model/ollama/list — list locally available Ollama models.
async fn ollama_list(State(_state): State<AppState>) -> impl IntoResponse {
    let base_url = ollama_base_url();
    let url = format!("{base_url}/api/tags");
    let client = reqwest::Client::new();
    match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = match r.json().await {
                Ok(v) => v,
                Err(e) => {
                    return (
                        StatusCode::BAD_GATEWAY,
                        Json(serde_json::json!({"error": format!("Failed to parse Ollama response: {e}")})),
                    )
                        .into_response();
                }
            };
            Json(body).into_response()
        }
        Ok(r) => {
            let status = r.status().as_u16();
            let err = r.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": format!("Ollama error: {err}")})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Failed to connect to Ollama: {e}")})),
        )
            .into_response(),
    }
}

/// DELETE /api/v1/model/ollama/{name} — delete an Ollama model by name.
async fn ollama_delete(
    State(_state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let base_url = ollama_base_url();
    let url = format!("{base_url}/api/delete");
    let client = reqwest::Client::new();
    match client
        .delete(&url)
        .json(&serde_json::json!({ "model": name }))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => StatusCode::NO_CONTENT.into_response(),
        Ok(r) => {
            let status = r.status().as_u16();
            let err = r.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": format!("Ollama error: {err}")})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Failed to connect to Ollama: {e}")})),
        )
            .into_response(),
    }
}

// ── Health ──────────────────────────────────────────────────────────────

/// GET /api/v1/model/health — model service health check.
async fn model_health(State(_state): State<AppState>) -> impl IntoResponse {
    let base_url = ollama_base_url();
    let url = format!("{base_url}/api/tags");
    let client = reqwest::Client::new();
    let ollama_ok = client
        .get(&url)
        .send()
        .await
        .map_or(false, |r| r.status().is_success());
    Json(serde_json::json!({
        "status": if ollama_ok { "ok" } else { "degraded" },
        "ollama": if ollama_ok { "ok" } else { "unavailable" },
    }))
}

/// GET /api/v1/ai/health — AI subsystem health check.
async fn ai_health(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "subsystems": {
            "inference": "ok",
            "routing": "ok",
            "cache": "ok",
        },
    }))
}
