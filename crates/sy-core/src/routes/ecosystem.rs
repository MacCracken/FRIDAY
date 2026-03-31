//! Ecosystem routes — service registry and health probes.
//!
//! Reads from a static in-memory registry of known ecosystem services
//! (Shruti, Rasa, Mneme, Tazama, etc.) and runtime health checks.

use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/ecosystem/services/{id}", get(get_service))
        .route(
            "/api/v1/ecosystem/services/{id}/enable",
            post(enable_service),
        )
        .route(
            "/api/v1/ecosystem/services/{id}/disable",
            post(disable_service),
        )
        .route("/api/v1/ecosystem/services/{id}/probe", post(probe_service))
        .route(
            "/api/v1/ecosystem/services/agnos/sandbox-profiles",
            get(agnos_sandbox_profiles),
        )
}

/// Static registry of known ecosystem services.
fn known_services() -> serde_json::Value {
    serde_json::json!({
        "shruti": {"id": "shruti", "name": "Shruti DAW", "description": "Audio workstation", "defaultUrl": "http://127.0.0.1:9010"},
        "rasa": {"id": "rasa", "name": "Rasa", "description": "Image editor", "defaultUrl": "http://127.0.0.1:9020"},
        "mneme": {"id": "mneme", "name": "Mneme", "description": "Knowledge base", "defaultUrl": "http://127.0.0.1:9030"},
        "tazama": {"id": "tazama", "name": "Tazama", "description": "Video editor", "defaultUrl": "http://127.0.0.1:9040"},
        "ifran": {"id": "ifran", "name": "Ifran", "description": "Font manager", "defaultUrl": "http://127.0.0.1:9050"},
        "hoosh": {"id": "hoosh", "name": "Hoosh", "description": "LLM gateway", "defaultUrl": "http://127.0.0.1:8088"},
    })
}

async fn get_service(Path(id): Path<String>) -> impl IntoResponse {
    let registry = known_services();
    match registry.get(&id) {
        Some(svc) => Json(svc.clone()).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Service not found in registry"})),
        )
            .into_response(),
    }
}

async fn enable_service(Path(id): Path<String>) -> impl IntoResponse {
    let registry = known_services();
    match registry.get(&id) {
        Some(_) => Json(serde_json::json!({
            "serviceId": id,
            "enabled": true,
            "message": "Service enabled",
        }))
        .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Service not found in registry"})),
        )
            .into_response(),
    }
}

async fn disable_service(Path(id): Path<String>) -> impl IntoResponse {
    let registry = known_services();
    match registry.get(&id) {
        Some(_) => Json(serde_json::json!({
            "serviceId": id,
            "enabled": false,
            "message": "Service disabled",
        }))
        .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Service not found in registry"})),
        )
            .into_response(),
    }
}

/// POST /api/v1/ecosystem/services/{id}/probe — health probe.
///
/// In production this would HTTP GET the service's health endpoint.
/// For now it returns a placeholder.
async fn probe_service(Path(id): Path<String>) -> impl IntoResponse {
    let registry = known_services();
    match registry.get(&id) {
        Some(svc) => {
            let url = svc
                .get("defaultUrl")
                .and_then(|u| u.as_str())
                .unwrap_or("unknown");
            Json(serde_json::json!({
                "serviceId": id,
                "url": url,
                "healthy": serde_json::Value::Null,
                "message": "Probe dispatched — result pending",
            }))
            .into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Service not found in registry"})),
        )
            .into_response(),
    }
}

/// GET /api/v1/ecosystem/services/agnos/sandbox-profiles — list AGNOS sandbox profiles.
async fn agnos_sandbox_profiles() -> impl IntoResponse {
    Json(serde_json::json!({
        "profiles": [
            {"id": "default", "name": "Default", "isolation": "namespace", "allowNetwork": true},
            {"id": "strict", "name": "Strict", "isolation": "vm", "allowNetwork": false},
            {"id": "dev", "name": "Development", "isolation": "namespace", "allowNetwork": true},
        ],
        "total": 3,
    }))
    .into_response()
}
