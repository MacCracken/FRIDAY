//! Integration proxy — reusable helpers for forwarding requests to external APIs.
//!
//! Pattern: resolve credentials from DB → build auth header → forward request → return JSON.

use axum::Json;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use reqwest::header::AUTHORIZATION;
use sqlx::PgPool;

use crate::db::integrations;

/// Authentication mode for upstream API calls.
pub enum AuthMode {
    /// Bearer token from integration config field.
    Bearer(String),
    /// Basic auth (base64-encoded "user:pass").
    Basic(String),
    /// API key in a custom header.
    ApiKey { header: String, value: String },
}

/// Resolve the first enabled integration for a platform and extract a config field as the token.
pub async fn resolve_bearer_token(
    pool: &PgPool,
    platform: &str,
    config_field: &str,
) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    let integration = integrations::find_enabled_by_platform(pool, platform)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": format!("No enabled {platform} integration found")})),
            )
        })?;

    integration
        .config
        .get(config_field)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Integration missing {config_field} in config")})),
            )
        })
}

/// Resolve integration config and extract arbitrary fields.
pub async fn resolve_config(
    pool: &PgPool,
    platform: &str,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let integration = integrations::find_enabled_by_platform(pool, platform)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": format!("No enabled {platform} integration found")})),
            )
        })?;

    Ok(integration.config)
}

/// Forward a GET request to an external API with auth.
pub async fn proxy_get(
    base_url: &str,
    path: &str,
    auth: &AuthMode,
    query_string: Option<&str>,
) -> impl IntoResponse {
    let url = match query_string {
        Some(qs) if !qs.is_empty() => format!("{base_url}{path}?{qs}"),
        _ => format!("{base_url}{path}"),
    };

    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    req = apply_auth(req, auth);

    match req.send().await {
        Ok(res) if res.status().is_success() => {
            let body: serde_json::Value = res.json().await.unwrap_or(serde_json::json!(null));
            (StatusCode::OK, Json(body)).into_response()
        }
        Ok(res) => {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": body})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Upstream request failed: {e}")})),
        )
            .into_response(),
    }
}

/// Forward a POST request with JSON body to an external API with auth.
pub async fn proxy_post(
    base_url: &str,
    path: &str,
    auth: &AuthMode,
    body: &serde_json::Value,
) -> impl IntoResponse {
    let url = format!("{base_url}{path}");

    let client = reqwest::Client::new();
    let mut req = client.post(&url).json(body);
    req = apply_auth(req, auth);

    match req.send().await {
        Ok(res) if res.status().is_success() => {
            let status = res.status().as_u16();
            let body: serde_json::Value = res.json().await.unwrap_or(serde_json::json!(null));
            (
                StatusCode::from_u16(status).unwrap_or(StatusCode::OK),
                Json(body),
            )
                .into_response()
        }
        Ok(res) => {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": body})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Upstream request failed: {e}")})),
        )
            .into_response(),
    }
}

fn apply_auth(req: reqwest::RequestBuilder, auth: &AuthMode) -> reqwest::RequestBuilder {
    match auth {
        AuthMode::Bearer(token) => req.bearer_auth(token),
        AuthMode::Basic(encoded) => req.header(AUTHORIZATION, format!("Basic {encoded}")),
        AuthMode::ApiKey { header, value } => req.header(header.as_str(), value.as_str()),
    }
}
