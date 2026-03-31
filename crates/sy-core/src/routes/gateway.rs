//! Gateway routes — system info, version, ecosystem services.

use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/gateway", get(overview))
        .route("/api/v1/gateway/info", get(info))
        .route("/api/v1/gateway/version", get(version))
        .route("/api/v1/ecosystem/services", get(ecosystem_services))
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
