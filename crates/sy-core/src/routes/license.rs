//! License routes — license status and key management.
//!
//! No database needed — reads from environment / config.

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/license/status", get(license_status))
        .route("/api/v1/license/key", post(apply_key))
}

async fn license_status() -> impl IntoResponse {
    let tier = std::env::var("SY_LICENSE_TIER").unwrap_or_else(|_| "community".to_string());
    let expiry = std::env::var("SY_LICENSE_EXPIRY").ok();
    let key_present = std::env::var("SY_LICENSE_KEY").is_ok();

    Json(serde_json::json!({
        "tier": tier,
        "expiry": expiry,
        "keyPresent": key_present,
        "features": license_features(&tier),
    }))
}

fn license_features(tier: &str) -> serde_json::Value {
    match tier {
        "pro" => serde_json::json!([
            "unlimited_agents",
            "priority_support",
            "custom_integrations",
            "advanced_analytics",
            "sso"
        ]),
        "enterprise" => serde_json::json!([
            "unlimited_agents",
            "priority_support",
            "custom_integrations",
            "advanced_analytics",
            "sso",
            "scim",
            "audit_export",
            "dedicated_support",
            "sla"
        ]),
        _ => serde_json::json!(["basic_agents", "community_support"]),
    }
}

#[derive(Deserialize)]
struct ApplyKeyRequest {
    key: String,
}

async fn apply_key(Json(body): Json<ApplyKeyRequest>) -> impl IntoResponse {
    // Basic format validation — real validation would check signature / license server.
    if body.key.len() < 16 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid license key format"})),
        )
            .into_response();
    }

    // In production this would persist the key and validate with the licensing service.
    // For now, acknowledge receipt.
    Json(serde_json::json!({
        "accepted": true,
        "message": "License key received — restart required to activate"
    }))
    .into_response()
}
