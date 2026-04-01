//! Admin settings routes — system-wide preference CRUD.
//!
//! GET   /api/v1/admin/settings        — list all settings
//! PATCH /api/v1/admin/settings        — update settings (partial)

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/admin/settings", get(list_settings))
        .route("/api/v1/admin/settings", patch(update_settings))
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
    if let Some(max) = body.max_sessions_per_user {
        if max == 0 {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "maxSessionsPerUser must be greater than 0"})),
            )
                .into_response();
        }
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
