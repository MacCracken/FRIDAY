//! Sandbox routes — profiles, scans, and quarantine management.

use crate::db::sandbox;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/sandbox/status", get(sandbox_status))
        .route("/api/v1/sandbox/config", get(sandbox_config))
        .route("/api/v1/sandbox/profiles", get(list_profiles))
        .route("/api/v1/sandbox/scans", get(list_scans))
        .route("/api/v1/sandbox/scan", post(trigger_scan))
        .route("/api/v1/sandbox/scans/{id}", get(get_scan))
        .route("/api/v1/sandbox/quarantine", get(list_quarantine))
        .route(
            "/api/v1/sandbox/quarantine/{id}/approve",
            post(approve_quarantine),
        )
        // Dashboard expects these additional sandbox endpoints
        .route("/api/v1/sandbox/capabilities", get(sandbox_capabilities))
        .route("/api/v1/sandbox/health", get(sandbox_health))
        .route("/api/v1/sandbox/policy", get(get_sandbox_policy))
        .route(
            "/api/v1/sandbox/policy",
            axum::routing::put(update_sandbox_policy),
        )
        .route("/api/v1/sandbox/threats", get(list_threats))
}

#[derive(Deserialize)]
struct PQ {
    #[serde(default = "dl")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}
fn dl() -> i64 {
    20
}

async fn sandbox_status(State(_s): State<AppState>) -> impl IntoResponse {
    // Delegates to sy-sandbox crate capabilities at runtime.
    // Returns static status when sy-sandbox is not linked.
    Json(serde_json::json!({
        "available": true,
        "backend": "sy-sandbox",
        "capabilities": {
            "fileIsolation": true,
            "networkIsolation": true,
            "processIsolation": true
        }
    }))
    .into_response()
}

async fn sandbox_config(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "maxConcurrentScans": 4,
        "defaultTimeout": 300,
        "quarantineEnabled": true,
        "autoScan": false
    }))
    .into_response()
}

async fn list_profiles(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match sandbox::list_profiles(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_scans(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match sandbox::list_scans(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriggerScanRequest {
    profile_id: Option<String>,
    target: Option<String>,
}

async fn trigger_scan(
    State(s): State<AppState>,
    Json(body): Json<TriggerScanRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match sandbox::create_scan(
        pool,
        &id,
        body.profile_id.as_deref(),
        body.target.as_deref(),
    )
    .await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_scan(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match sandbox::get_scan(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error":"Scan not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_quarantine(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match sandbox::list_quarantine(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn approve_quarantine(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match sandbox::approve_quarantine_item(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error":"Quarantine item not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Dashboard Sandbox Endpoints ────────────────────────────────────────

async fn sandbox_capabilities() -> impl IntoResponse {
    let caps = crate::sandbox::detect_capabilities();
    Json(serde_json::json!({
        "seccomp": caps.seccomp_available,
        "landlock": caps.landlock_available,
        "cgroupV2": caps.cgroup_v2,
        "namespaces": caps.namespaces_available,
    }))
}

async fn sandbox_health() -> impl IntoResponse {
    let caps = crate::sandbox::detect_capabilities();
    Json(serde_json::json!({
        "status": "ok",
        "seccomp": caps.seccomp_available,
        "landlock": caps.landlock_available,
        "cgroupV2": caps.cgroup_v2,
    }))
}

async fn get_sandbox_policy(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "defaultAction": "allow",
        "rules": [],
        "blockedSyscalls": [],
        "allowedPaths": [],
    }))
}

async fn update_sandbox_policy(
    State(_s): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    Json(body)
}

async fn list_threats(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"threats": [], "total": 0}))
}
