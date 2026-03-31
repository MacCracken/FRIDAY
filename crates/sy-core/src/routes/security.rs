//! Security routes — DLP policies, SRA assessments, events, scans, ATHI, access review, TLS.

use crate::db::security;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/security/dlp/policies", get(list_dlp_policies))
        .route(
            "/api/v1/security/sra/assessments",
            get(list_sra_assessments),
        )
        .route("/api/v1/security/events", get(list_security_events))
        .route("/api/v1/security/events/{id}", get(get_security_event))
        .route("/api/v1/security/policy", get(get_security_policy))
        .route("/api/v1/security/policy", put(update_security_policy))
        .route("/api/v1/security/scans", get(list_security_scans))
        .route("/api/v1/security/scans", post(trigger_security_scan))
        .route("/api/v1/security/scans/{id}", get(get_security_scan))
        .route("/api/v1/security/athi/summary", get(get_athi_summary))
        .route("/api/v1/security/athi/scenarios", get(list_athi_scenarios))
        .route(
            "/api/v1/security/access-review/campaigns",
            get(list_access_review_campaigns),
        )
        .route(
            "/api/v1/security/access-review/campaigns",
            post(create_access_review_campaign),
        )
        .route("/api/v1/security/tls", get(get_tls_status))
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

// --- DLP / SRA (existing) ---

async fn list_dlp_policies(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::list_dlp_policies(pool).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct LimitQuery {
    #[serde(default = "dl")]
    limit: i64,
}

async fn list_sra_assessments(
    State(s): State<AppState>,
    Query(q): Query<LimitQuery>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::list_sra_assessments(pool, q.limit.min(100)).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Security events ---

async fn list_security_events(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::list_security_events(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_security_event(
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
    match security::get_security_event(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Security event not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Security policy ---

async fn get_security_policy(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::get_security_policy(pool, "default").await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No security policy configured"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePolicyRequest {
    name: String,
    policy_json: serde_json::Value,
    #[serde(default = "default_true")]
    enabled: bool,
}
fn default_true() -> bool {
    true
}

async fn update_security_policy(
    State(s): State<AppState>,
    Json(body): Json<UpdatePolicyRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::upsert_security_policy(
        pool,
        &id,
        "default",
        &body.name,
        &body.policy_json,
        body.enabled,
    )
    .await
    {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Security scans ---

async fn list_security_scans(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::list_security_scans(pool, "default", q.limit.min(100), q.offset).await {
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
    #[serde(default = "default_scan_type")]
    scan_type: String,
}
fn default_scan_type() -> String {
    "full".to_string()
}

async fn trigger_security_scan(
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
    match security::create_security_scan(pool, &id, "default", &body.scan_type).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_security_scan(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::get_security_scan(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Scan not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- ATHI ---

async fn get_athi_summary(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::get_athi_summary(pool, "default").await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => {
            Json(serde_json::json!({"totalScenarios": 0, "passing": 0, "failing": 0, "score": 0.0}))
                .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_athi_scenarios(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::list_athi_scenarios(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Access review campaigns ---

async fn list_access_review_campaigns(
    State(s): State<AppState>,
    Query(q): Query<PQ>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::list_access_review_campaigns(pool, "default", q.limit.min(100), q.offset).await
    {
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
struct CreateCampaignRequest {
    name: String,
    scope: String,
    reviewer: String,
    due_at: Option<i64>,
}

async fn create_access_review_campaign(
    State(s): State<AppState>,
    Json(body): Json<CreateCampaignRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::create_access_review_campaign(
        pool,
        &id,
        "default",
        &body.name,
        &body.scope,
        &body.reviewer,
        body.due_at,
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

// --- TLS status ---

async fn get_tls_status(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match security::get_tls_status(pool, "default").await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No TLS status available"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
