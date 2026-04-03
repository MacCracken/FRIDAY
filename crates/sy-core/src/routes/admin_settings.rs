//! Admin settings routes — system-wide preference CRUD.
//!
//! GET   /api/v1/admin/settings        — list all settings
//! PATCH /api/v1/admin/settings        — update settings (partial)

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, patch, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/admin/settings", get(list_settings))
        .route("/api/v1/admin/settings", patch(update_settings))
        // Secrets management (API keys, tokens)
        .route("/api/v1/secrets", get(list_secrets))
        .route("/api/v1/secrets/{name}", get(check_secret))
        .route("/api/v1/secrets/{name}", put(set_secret))
        .route("/api/v1/secrets/{name}", delete(delete_secret))
}

/// GET /api/v1/admin/settings — return current system preferences.
async fn list_settings(State(state): State<AppState>) -> impl IntoResponse {
    let has_db = state.db().is_some();
    Json(serde_json::json!({
        "environment": state.config().environment,
        "version": state.version(),
        "databaseAvailable": has_db,
        "settings": {
            "telemetryEnabled": false,
            "maintenanceMode": false,
            "maxSessionsPerUser": 10,
            "defaultTenantId": "default",
        },
        "message": "Settings management not yet persisted to database",
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSettingsRequest {
    #[serde(default)]
    telemetry_enabled: Option<bool>,
    #[serde(default)]
    maintenance_mode: Option<bool>,
    #[serde(default)]
    max_sessions_per_user: Option<u32>,
}

/// PATCH /api/v1/admin/settings — apply a partial settings update.
///
/// Persisted settings storage will be wired in a later phase.
/// For now, acknowledges the request and echoes back the requested changes.
async fn update_settings(
    State(_state): State<AppState>,
    Json(body): Json<UpdateSettingsRequest>,
) -> impl IntoResponse {
    // Validate any fields that need it
    if let Some(max) = body.max_sessions_per_user
        && max == 0
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "maxSessionsPerUser must be greater than 0"})),
        )
            .into_response();
    }

    Json(serde_json::json!({
        "updated": true,
        "changes": {
            "telemetryEnabled": body.telemetry_enabled,
            "maintenanceMode": body.maintenance_mode,
            "maxSessionsPerUser": body.max_sessions_per_user,
        },
        "message": "Settings acknowledged — persistence not yet connected",
        "stub": true,
    }))
    .into_response()
}

// ── Secrets Management ──────────────────────────────────────────────────────

/// GET /api/v1/secrets — list secret key names (not values).
async fn list_secrets(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return Json(serde_json::json!({"keys": []})).into_response();
    };

    // Use security.policy as a key/value store for secrets (prefix: secret:)
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT key FROM security.policy WHERE key LIKE 'secret:%' ORDER BY key")
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    let keys: Vec<String> = rows
        .into_iter()
        .map(|(k,)| k.strip_prefix("secret:").unwrap_or(&k).to_string())
        .collect();

    Json(serde_json::json!({"keys": keys})).into_response()
}

/// GET /api/v1/secrets/{name} — check if a secret exists (never returns the value).
async fn check_secret(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let exists = if let Some(pool) = state.db() {
        let key = format!("secret:{name}");
        let row: Option<(String,)> =
            sqlx::query_as("SELECT key FROM security.policy WHERE key = $1")
                .bind(&key)
                .fetch_optional(pool)
                .await
                .unwrap_or(None);
        row.is_some()
    } else {
        // Check env var as fallback
        std::env::var(&name).map(|v| !v.is_empty()).unwrap_or(false)
    };

    Json(serde_json::json!({"name": name, "exists": exists}))
}

#[derive(Deserialize)]
struct SetSecretRequest {
    value: String,
}

/// PUT /api/v1/secrets/{name} — store a secret.
async fn set_secret(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SetSecretRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };

    let key = format!("secret:{name}");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    match sqlx::query(
        "INSERT INTO security.policy (key, value, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3",
    )
    .bind(&key)
    .bind(&body.value)
    .bind(now)
    .execute(pool)
    .await
    {
        Ok(_) => {
            // Also set as env var so the running process picks it up immediately
            // SAFETY: single-threaded init; no concurrent env reads during set
            unsafe { std::env::set_var(&name, &body.value) };
            (
                StatusCode::OK,
                Json(serde_json::json!({"saved": true, "name": name})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// DELETE /api/v1/secrets/{name} — remove a secret.
async fn delete_secret(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };

    let key = format!("secret:{name}");
    let _ = sqlx::query("DELETE FROM security.policy WHERE key = $1")
        .bind(&key)
        .execute(pool)
        .await;

    // SAFETY: single-threaded cleanup; no concurrent env reads during remove
    unsafe { std::env::remove_var(&name) };
    StatusCode::NO_CONTENT.into_response()
}
