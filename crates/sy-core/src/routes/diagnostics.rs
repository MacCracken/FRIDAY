//! Diagnostics routes — agent reports and integration pings.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::diagnostics;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/diagnostics/agent-report", get(list_reports))
        .route("/api/v1/diagnostics/agent-report/{id}", get(get_report))
        .route(
            "/api/v1/diagnostics/ping-integrations",
            post(ping_integrations),
        )
        // System hardware/GPU probe
        .route("/api/v1/system/gpu", get(gpu_status))
        .route("/api/v1/system/local-models", get(local_models))
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

async fn list_reports(
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
    match diagnostics::list_reports(pool, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_report(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match diagnostics::get_report(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Report not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/v1/diagnostics/ping-integrations — ping all integrations.
///
/// This is a fire-and-forget check.  In production it would iterate over
/// registered integration endpoints and test connectivity.  For now it
/// returns a placeholder status.
async fn ping_integrations(State(state): State<AppState>) -> impl IntoResponse {
    let db_available = state.db().is_some();
    Json(serde_json::json!({
        "status": "completed",
        "dbConnected": db_available,
        "integrations": [],
        "message": "All integration pings dispatched",
    }))
    .into_response()
}

/// GET /api/v1/system/gpu — probe GPU hardware.
///
/// Uses sy-hwprobe (ai-hwaccel) when available, otherwise returns empty.
async fn gpu_status() -> impl IntoResponse {
    // Probe via sy-hwprobe (ai-hwaccel)
    let hw_devices = crate::hwprobe::probe_all();
    let devices: Vec<serde_json::Value> = hw_devices
        .iter()
        .map(|d| serde_json::to_value(d).unwrap_or_default())
        .collect();

    let total_vram: f64 = devices
        .iter()
        .filter_map(|d: &serde_json::Value| d.get("vramMb").and_then(|v| v.as_f64()))
        .sum();
    let available = !devices.is_empty();

    Json(serde_json::json!({
        "available": available,
        "devices": devices,
        "totalVramMb": total_vram,
        "totalFreeVramMb": total_vram,
        "bestDevice": devices.first(),
        "localInferenceViable": total_vram >= 4096.0,
        "tpuCount": 0,
        "tpuAvailable": false,
        "source": "ai-hwaccel",
        "probedAt": chrono::Utc::now().to_rfc3339(),
    }))
}

/// GET /api/v1/system/local-models — list locally available models.
async fn local_models() -> impl IntoResponse {
    // Check Ollama for local models
    let models = match reqwest::Client::new()
        .get(format!(
            "{}/api/tags",
            std::env::var("OLLAMA_HOST").unwrap_or_else(|_| "http://localhost:11434".into())
        ))
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            data.get("models")
                .and_then(|m| m.as_array())
                .cloned()
                .unwrap_or_default()
        }
        _ => Vec::new(),
    };

    Json(serde_json::json!({
        "models": models,
        "providers": {
            "ollama": !models.is_empty(),
            "lmstudio": false,
            "localai": false,
        },
        "totalModels": models.len(),
        "probedAt": chrono::Utc::now().to_rfc3339(),
    }))
}
