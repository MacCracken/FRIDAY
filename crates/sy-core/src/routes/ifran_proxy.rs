//! Ifran proxy routes — REST proxy for the Ifran LLM controller.
//!
//! Proxies all /api/v1/ifran/* requests to the Ifran server (default localhost:8420).
//! No external auth — Ifran is an internal service on the same machine.
//!
//! Env: IFRAN_API_URL (default http://localhost:8420)

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use std::convert::Infallible;

use crate::state::AppState;

fn ifran_url() -> String {
    std::env::var("IFRAN_API_URL").unwrap_or_else(|_| "http://localhost:8420".to_string())
}

pub fn router() -> Router<AppState> {
    Router::new()
        // Models
        .route("/api/v1/ifran/models", get(proxy_get_handler))
        .route("/api/v1/ifran/models/{id}", get(proxy_get_with_id))
        .route("/api/v1/ifran/models/{id}", delete(proxy_delete_with_id))
        .route("/api/v1/ifran/models/pull", post(proxy_post_handler))
        // Inference
        .route("/api/v1/ifran/inference", post(proxy_post_handler))
        .route("/api/v1/ifran/inference/stream", post(inference_stream))
        // Health / Status
        .route("/api/v1/ifran/health", get(proxy_get_handler))
        .route("/api/v1/ifran/status", get(proxy_get_handler))
        .route("/api/v1/ifran/gpu/telemetry", get(proxy_get_handler))
        // Training
        .route("/api/v1/ifran/training/jobs", get(proxy_get_handler))
        .route("/api/v1/ifran/training/jobs", post(proxy_post_handler))
        .route("/api/v1/ifran/training/jobs/{id}", get(proxy_get_with_id))
        .route(
            "/api/v1/ifran/training/jobs/{id}/cancel",
            post(proxy_post_with_id),
        )
        .route(
            "/api/v1/ifran/training/jobs/{id}/checkpoints",
            get(proxy_get_with_id),
        )
        .route(
            "/api/v1/ifran/training/jobs/{id}/metrics",
            get(proxy_get_with_id),
        )
        .route(
            "/api/v1/ifran/training/jobs/{id}/stream",
            get(training_stream),
        )
        // Eval
        .route("/api/v1/ifran/eval/runs", get(proxy_get_handler))
        .route("/api/v1/ifran/eval/runs", post(proxy_post_handler))
        .route("/api/v1/ifran/eval/runs/{runId}", get(proxy_get_with_id))
        // Experiments
        .route("/api/v1/ifran/experiments", get(proxy_get_handler))
        .route("/api/v1/ifran/experiments", post(proxy_post_handler))
        .route(
            "/api/v1/ifran/experiments/{experimentId}",
            get(proxy_get_with_id),
        )
        // RLHF
        .route("/api/v1/ifran/rlhf/sessions", get(proxy_get_handler))
        .route("/api/v1/ifran/rlhf/sessions", post(proxy_post_handler))
        .route(
            "/api/v1/ifran/rlhf/sessions/{sessionId}",
            get(proxy_get_with_id),
        )
        .route(
            "/api/v1/ifran/rlhf/sessions/{sessionId}/annotate",
            post(proxy_post_with_id),
        )
        .route(
            "/api/v1/ifran/rlhf/sessions/{sessionId}/export-dpo",
            get(proxy_get_with_id),
        )
        // Fleet
        .route("/api/v1/ifran/fleet/nodes", get(proxy_get_handler))
        .route("/api/v1/ifran/fleet/nodes/{nodeId}", get(proxy_get_with_id))
        // Marketplace
        .route("/api/v1/ifran/marketplace/models", get(proxy_get_handler))
        .route(
            "/api/v1/ifran/marketplace/models/{modelId}/pull",
            post(proxy_post_with_id),
        )
        // Lineage
        .route(
            "/api/v1/ifran/lineage/{modelId}/ancestry",
            get(proxy_get_with_id),
        )
        // Bridge (SY ↔ Ifran delegation)
        .route("/api/v1/ifran/bridge/capabilities", get(proxy_get_handler))
        .route("/api/v1/ifran/bridge/jobs", get(proxy_get_handler))
        .route("/api/v1/ifran/bridge/jobs", post(proxy_post_handler))
        .route("/api/v1/ifran/bridge/jobs/{id}", get(proxy_get_with_id))
        .route(
            "/api/v1/ifran/bridge/delegated-jobs",
            get(proxy_get_handler),
        )
        .route("/api/v1/ifran/bridge/webhook", post(proxy_post_handler))
}

// ── Generic proxy handlers ───────────────────────────────────────────────

/// Generic GET proxy — forwards the request path + query string to Ifran.
async fn proxy_get_handler(
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
) -> impl IntoResponse {
    let ifran_path = uri
        .path()
        .strip_prefix("/api/v1/ifran")
        .unwrap_or(uri.path());
    let qs = uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    let url = format!("{}/api/v1{ifran_path}{qs}", ifran_url());

    match reqwest::get(&url).await {
        Ok(res) if res.status().is_success() => {
            let body: serde_json::Value = res.json().await.unwrap_or(serde_json::json!(null));
            Json(body).into_response()
        }
        Ok(res) => {
            let s = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": body})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Ifran unreachable: {e}")})),
        )
            .into_response(),
    }
}

/// GET with path param — extracts the ID and forwards.
async fn proxy_get_with_id(
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
) -> impl IntoResponse {
    // Reuse the same logic — OriginalUri has the full path
    proxy_get_handler(axum::extract::OriginalUri(uri)).await
}

/// Generic POST proxy — forwards JSON body to Ifran.
async fn proxy_post_handler(
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let ifran_path = uri
        .path()
        .strip_prefix("/api/v1/ifran")
        .unwrap_or(uri.path());
    let url = format!("{}/api/v1{ifran_path}", ifran_url());

    let client = reqwest::Client::new();
    match client.post(&url).json(&body).send().await {
        Ok(res) if res.status().is_success() => {
            let s = res.status().as_u16();
            let data: serde_json::Value = res.json().await.unwrap_or(serde_json::json!(null));
            (
                StatusCode::from_u16(s).unwrap_or(StatusCode::OK),
                Json(data),
            )
                .into_response()
        }
        Ok(res) => {
            let s = res.status().as_u16();
            let data = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": data})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Ifran unreachable: {e}")})),
        )
            .into_response(),
    }
}

/// POST with path param.
async fn proxy_post_with_id(
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
    body: Option<Json<serde_json::Value>>,
) -> impl IntoResponse {
    let ifran_path = uri
        .path()
        .strip_prefix("/api/v1/ifran")
        .unwrap_or(uri.path());
    let url = format!("{}/api/v1{ifran_path}", ifran_url());
    let payload = body.map(|b| b.0).unwrap_or(serde_json::json!({}));

    let client = reqwest::Client::new();
    match client.post(&url).json(&payload).send().await {
        Ok(res) if res.status().is_success() => {
            let s = res.status().as_u16();
            let data: serde_json::Value = res.json().await.unwrap_or(serde_json::json!(null));
            (
                StatusCode::from_u16(s).unwrap_or(StatusCode::OK),
                Json(data),
            )
                .into_response()
        }
        Ok(res) => {
            let s = res.status().as_u16();
            let data = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": data})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Ifran unreachable: {e}")})),
        )
            .into_response(),
    }
}

/// DELETE with path param.
async fn proxy_delete_with_id(
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
) -> impl IntoResponse {
    let ifran_path = uri
        .path()
        .strip_prefix("/api/v1/ifran")
        .unwrap_or(uri.path());
    let url = format!("{}/api/v1{ifran_path}", ifran_url());

    let client = reqwest::Client::new();
    match client.delete(&url).send().await {
        Ok(res) if res.status().is_success() => StatusCode::NO_CONTENT.into_response(),
        Ok(res) => {
            let s = res.status().as_u16();
            let data = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": data})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Ifran unreachable: {e}")})),
        )
            .into_response(),
    }
}

// ── SSE streaming proxies ────────────────────────────────────────────────

/// POST /api/v1/ifran/inference/stream — relay SSE from Ifran inference.
async fn inference_stream(Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    sse_relay("/api/v1/inference/stream", Some(&body)).await
}

/// GET /api/v1/ifran/training/jobs/:id/stream — relay SSE from Ifran training.
async fn training_stream(
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
) -> impl IntoResponse {
    let ifran_path = uri
        .path()
        .strip_prefix("/api/v1/ifran")
        .unwrap_or(uri.path());
    sse_relay(&format!("/api/v1{ifran_path}"), None).await
}

async fn sse_relay(path: &str, body: Option<&serde_json::Value>) -> axum::response::Response {
    let url = format!("{}{path}", ifran_url());
    let client = reqwest::Client::new();

    let req = if let Some(b) = body {
        client
            .post(&url)
            .header("Accept", "text/event-stream")
            .json(b)
    } else {
        client.get(&url).header("Accept", "text/event-stream")
    };

    let response = match req.send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let s = r.status().as_u16();
            let err = r.text().await.unwrap_or_default();
            return (
                StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": err})),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": format!("Ifran unreachable: {e}")})),
            )
                .into_response();
        }
    };

    // Read NDJSON/SSE body and relay as SSE events
    let text = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": format!("Failed to read Ifran stream: {e}")})),
            )
                .into_response();
        }
    };

    let events: Vec<Result<Event, Infallible>> = text
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            if let Some(data) = line.strip_prefix("data: ") {
                Some(Ok(Event::default().data(data)))
            } else if !line.starts_with(':') {
                Some(Ok(Event::default().data(line)))
            } else {
                None
            }
        })
        .collect();

    Sse::new(tokio_stream::iter(events))
        .keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(10)))
        .into_response()
}
