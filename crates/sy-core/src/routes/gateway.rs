//! Gateway routes — system info, version, ecosystem services.

use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/gateway", get(overview))
        .route("/api/v1/gateway", post(gateway_proxy))
        .route("/api/v1/gateway/info", get(info))
        .route("/api/v1/gateway/version", get(version))
        .route("/api/v1/ecosystem/services", get(ecosystem_services))
}

/// POST /api/v1/gateway — proxy a chat/completion request to the configured LLM backend.
///
/// Accepts messages, model, and optional personalityId.  Full streaming is
/// deferred until the Ifran integration is wired; for now returns a placeholder
/// response so the frontend contract is satisfied.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayProxyRequest {
    messages: serde_json::Value,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    personality_id: Option<String>,
}

async fn gateway_proxy(Json(body): Json<GatewayProxyRequest>) -> impl IntoResponse {
    let model = body.model.unwrap_or_else(|| "default".to_string());
    Json(serde_json::json!({
        "message": "Gateway proxy not yet connected to LLM backend",
        "model": model,
        "personalityId": body.personality_id,
        "messageCount": body.messages.as_array().map(|a| a.len()).unwrap_or(0),
        "stub": true,
    }))
}

/// Gateway overview — combined info, version, and services in one response.
async fn overview(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "version": state.version(),
        "uptimeSeconds": state.uptime_seconds(),
        "environment": state.config().environment,
        "engine": "sy-core (axum)",
        "services": [
            {"id": "agnostic", "displayName": "Agnostic Agentic System", "defaultUrl": "http://127.0.0.1:8000"},
            {"id": "agnos", "displayName": "AGNOS Runtime", "defaultUrl": "http://127.0.0.1:8090"},
            {"id": "daimon", "displayName": "Daimon Agent Orchestrator", "defaultUrl": "http://127.0.0.1:8090"},
            {"id": "ifran", "displayName": "Ifran LLM Controller", "defaultUrl": "http://127.0.0.1:8420"},
            {"id": "delta", "displayName": "Delta Code Forge", "defaultUrl": "http://127.0.0.1:8070"},
            {"id": "bullshift", "displayName": "BullShift Trading", "defaultUrl": "http://127.0.0.1:8787"},
            {"id": "shruti", "displayName": "Shruti DAW", "defaultUrl": "http://127.0.0.1:8050"},
            {"id": "rasa", "displayName": "Rasa Image Editor", "defaultUrl": "stdio://rasa-mcp"},
            {"id": "mneme", "displayName": "Mneme Knowledge Base", "defaultUrl": "http://127.0.0.1:3838"},
        ]
    }))
}

async fn info(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "version": state.version(),
        "uptimeSeconds": state.uptime_seconds(),
        "environment": state.config().environment,
        "engine": "sy-core (axum)",
    }))
}

async fn version(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "version": state.version(),
        "engine": "sy-core",
    }))
}

async fn ecosystem_services() -> impl IntoResponse {
    // Static service registry — mirrors service-discovery.ts
    Json(serde_json::json!([
        {"id": "agnostic", "displayName": "Agnostic Agentic System", "defaultUrl": "http://127.0.0.1:8000"},
        {"id": "agnos", "displayName": "AGNOS Runtime", "defaultUrl": "http://127.0.0.1:8090"},
        {"id": "daimon", "displayName": "Daimon Agent Orchestrator", "defaultUrl": "http://127.0.0.1:8090"},
        {"id": "ifran", "displayName": "Ifran LLM Controller", "defaultUrl": "http://127.0.0.1:8420"},
        {"id": "delta", "displayName": "Delta Code Forge", "defaultUrl": "http://127.0.0.1:8070"},
        {"id": "bullshift", "displayName": "BullShift Trading", "defaultUrl": "http://127.0.0.1:8787"},
        {"id": "shruti", "displayName": "Shruti DAW", "defaultUrl": "http://127.0.0.1:8050"},
        {"id": "rasa", "displayName": "Rasa Image Editor", "defaultUrl": "stdio://rasa-mcp"},
        {"id": "mneme", "displayName": "Mneme Knowledge Base", "defaultUrl": "http://127.0.0.1:3838"},
    ]))
}
