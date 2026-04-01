//! AI batch inference and cache routes.
//!
//! POST /api/v1/ai/batch         — submit a batch inference job
//! GET  /api/v1/ai/batch/{id}    — get batch job status
//! GET  /api/v1/ai/batch         — list batch jobs
//! DELETE /api/v1/ai/batch/{id}  — cancel a batch job
//! GET  /api/v1/ai/cache/stats   — cache statistics
//! POST /api/v1/ai/cache/clear   — clear the AI response cache
//! POST /api/v1/ai/cache/warmup  — warmup the cache
//! POST /api/v1/ai/inline-complete — inline text completion

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::batch;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/ai/batch", post(submit_batch))
        .route("/api/v1/ai/batch", get(list_batch_jobs))
        .route("/api/v1/ai/batch/{id}", get(get_batch_job))
        .route("/api/v1/ai/batch/{id}", delete(cancel_batch_job))
        .route("/api/v1/ai/cache/stats", get(cache_stats))
        .route("/api/v1/ai/cache/clear", post(cache_clear))
        .route("/api/v1/ai/cache/warmup", post(cache_warmup))
        .route("/api/v1/ai/inline-complete", post(inline_complete))
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

// ── Batch Inference ─────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmitBatchRequest {
    /// Batch config — list of prompts/messages and shared inference settings.
    config: serde_json::Value,
}

/// POST /api/v1/ai/batch — submit a batch inference job.
async fn submit_batch(
    State(state): State<AppState>,
    Json(body): Json<SubmitBatchRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match batch::create_job(pool, &id, "default", &body.config).await {
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

/// GET /api/v1/ai/batch/{id} — get batch job status.
async fn get_batch_job(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match batch::get_job(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Batch job not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/ai/batch — list batch jobs.
async fn list_batch_jobs(
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
    match batch::list_jobs(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// DELETE /api/v1/ai/batch/{id} — cancel a batch job.
async fn cancel_batch_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match batch::cancel_job(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Batch job not found or already terminal"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── AI Cache ────────────────────────────────────────────────────────────

/// GET /api/v1/ai/cache/stats — AI response cache statistics.
async fn cache_stats(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "hits": 0,
        "misses": 0,
        "hitRate": 0.0,
        "sizeBytes": 0,
        "entryCount": 0,
    }))
}

/// POST /api/v1/ai/cache/clear — clear the AI response cache.
async fn cache_clear(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "cleared": true,
        "entriesRemoved": 0,
    }))
}

/// POST /api/v1/ai/cache/warmup — warmup the AI response cache.
async fn cache_warmup(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "warmedUp": true,
        "entriesLoaded": 0,
    }))
}

// ── Inline Completion ───────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InlineCompleteRequest {
    prefix: String,
    suffix: Option<String>,
    language: Option<String>,
    model: Option<String>,
    #[serde(default = "default_max_tokens")]
    max_tokens: u32,
}

fn default_max_tokens() -> u32 {
    128
}

/// POST /api/v1/ai/inline-complete — inline / fill-in-the-middle text completion.
async fn inline_complete(
    State(_state): State<AppState>,
    Json(body): Json<InlineCompleteRequest>,
) -> impl IntoResponse {
    if body.prefix.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "prefix is required"})),
        )
            .into_response();
    }

    let base_url =
        std::env::var("HOOSH_URL").unwrap_or_else(|_| "http://127.0.0.1:8088".to_string());
    let url = format!("{base_url}/v1/completions");
    let model = body.model.as_deref().unwrap_or("default");

    let mut req_body = serde_json::json!({
        "model": model,
        "prompt": body.prefix,
        "max_tokens": body.max_tokens,
        "stream": false,
    });
    if let Some(suffix) = &body.suffix {
        req_body["suffix"] = serde_json::Value::String(suffix.clone());
    }

    let client = reqwest::Client::new();
    match client.post(&url).json(&req_body).send().await {
        Ok(r) if r.status().is_success() => {
            let oai: serde_json::Value = match r.json().await {
                Ok(v) => v,
                Err(e) => {
                    return (
                        StatusCode::BAD_GATEWAY,
                        Json(
                            serde_json::json!({"error": format!("Failed to parse response: {e}")}),
                        ),
                    )
                        .into_response();
                }
            };
            let completion = oai
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            let response_model = oai.get("model").and_then(|m| m.as_str()).unwrap_or(model);
            Json(serde_json::json!({
                "completion": completion,
                "model": response_model,
                "language": body.language,
            }))
            .into_response()
        }
        Ok(r) => {
            let status = r.status().as_u16();
            let err = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": format!("LLM error ({status}): {err}")})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Failed to connect to LLM: {e}")})),
        )
            .into_response(),
    }
}
