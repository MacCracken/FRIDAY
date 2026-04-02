//! Gateway routes — system info, version, ecosystem services.

use axum::extract::State;
use axum::http::StatusCode;
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
    // NOTE: /api/v1/ecosystem/services lives in ecosystem.rs
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
    let model = body.model.clone().unwrap_or_else(|| "default".to_string());

    let client = reqwest::Client::new();

    // Route to the appropriate provider based on model name or available keys
    let anthropic_key = std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .filter(|k| !k.is_empty());
    let openai_key = std::env::var("OPENAI_API_KEY")
        .ok()
        .filter(|k| !k.is_empty());

    let is_anthropic = model.contains("claude")
        || model.contains("anthropic")
        || (anthropic_key.is_some() && openai_key.is_none());

    let mut req = if is_anthropic {
        // Call Anthropic Messages API directly
        let key = match &anthropic_key {
            Some(k) => k.clone(),
            None => {
                return Json(serde_json::json!({
                    "error": "ANTHROPIC_API_KEY not configured",
                    "stub": true,
                }))
                .into_response();
            }
        };
        client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
            .json(&serde_json::json!({
                "model": model,
                "max_tokens": 4096,
                "messages": body.messages,
            }))
            .timeout(std::time::Duration::from_secs(120))
    } else if let Some(ref key) = openai_key {
        // Call OpenAI directly
        client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(key)
            .json(&serde_json::json!({
                "model": model,
                "messages": body.messages,
            }))
            .timeout(std::time::Duration::from_secs(120))
    } else {
        // Fall back to Hoosh/AGNOS LLM Gateway
        let hoosh_url = std::env::var("HOOSH_URL")
            .or_else(|_| std::env::var("AGNOS_GATEWAY_URL"))
            .unwrap_or_else(|_| "http://127.0.0.1:8088".to_string());

        let mut r = client
            .post(format!("{hoosh_url}/v1/chat/completions"))
            .json(&serde_json::json!({
                "model": model,
                "messages": body.messages,
                "stream": false,
            }))
            .timeout(std::time::Duration::from_secs(120));

        if let Ok(key) = std::env::var("AGNOS_GATEWAY_API_KEY") {
            r = r.bearer_auth(key);
        }
        r
    };

    match req.send().await {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!(null));
            Json(data).into_response()
        }
        Ok(resp) => {
            let status = resp.status().as_u16();
            let err_body = resp.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": err_body})),
            )
                .into_response()
        }
        Err(_) => {
            // Hoosh not available — return stub
            Json(serde_json::json!({
                "message": "LLM gateway not reachable",
                "model": model,
                "personalityId": body.personality_id,
                "messageCount": body.messages.as_array().map(|a| a.len()).unwrap_or(0),
                "stub": true,
            }))
            .into_response()
        }
    }
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
