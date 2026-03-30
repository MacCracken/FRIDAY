//! Model management routes — Ollama model pull with SSE progress streaming.
//!
//! POST /api/v1/model/ollama/pull — stream Ollama model download progress as SSE events.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::convert::Infallible;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/v1/model/ollama/pull", post(ollama_pull))
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
