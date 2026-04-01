//! IAC routes — infrastructure-as-code: templates, sync, validate, deployments, repo config.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::iac;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // ── Templates ──
        .route("/api/v1/iac/templates", get(list_templates))
        .route("/api/v1/iac/templates/{templateId}", get(get_template))
        .route(
            "/api/v1/iac/templates/{templateId}",
            delete(delete_template),
        )
        // ── Sync & validate ──
        .route("/api/v1/iac/sync", post(sync_templates))
        .route("/api/v1/iac/validate", post(validate_template))
        // ── SRA control templates ──
        .route(
            "/api/v1/iac/sra/{controlId}/templates",
            get(list_sra_templates),
        )
        // ── Deployments ──
        .route("/api/v1/iac/deployments", get(list_deployments))
        .route(
            "/api/v1/iac/deployments/{deploymentId}",
            get(get_deployment),
        )
        .route("/api/v1/iac/deployments", post(create_deployment))
        // ── Repo config ──
        .route("/api/v1/iac/repo", get(get_repo_config))
}

// ============================================================
// Shared helpers
// ============================================================

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

fn no_db() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "No DB"})),
    )
}

fn db_err(e: sqlx::Error) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"error": e.to_string()})),
    )
}

fn not_found(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"error": msg})),
    )
}

// ============================================================
// Templates
// ============================================================

async fn list_templates(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match iac::list_templates(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_template(
    State(s): State<AppState>,
    Path(template_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match iac::get_template(pool, &template_id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Template not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_template(
    State(s): State<AppState>,
    Path(template_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match iac::delete_template(pool, &template_id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Template not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Sync & validate (stubs — actual logic is external)
// ============================================================

async fn sync_templates(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "accepted",
        "message": "Template sync initiated"
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateRequest {
    content: String,
    #[serde(default)]
    kind: Option<String>,
}

async fn validate_template(
    State(_s): State<AppState>,
    Json(body): Json<ValidateRequest>,
) -> impl IntoResponse {
    let _ = body.content;
    Json(serde_json::json!({
        "valid": true,
        "errors": [],
        "stub": true
    }))
}

// ============================================================
// SRA control templates
// ============================================================

async fn list_sra_templates(
    State(s): State<AppState>,
    Path(control_id): Path<String>,
    Query(q): Query<PQ>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match iac::list_templates_for_control(pool, "default", &control_id, q.limit.min(100), q.offset)
        .await
    {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Deployments
// ============================================================

async fn list_deployments(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match iac::list_deployments(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_deployment(
    State(s): State<AppState>,
    Path(deployment_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match iac::get_deployment(pool, &deployment_id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Deployment not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDeploymentRequest {
    template_id: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

fn empty_obj() -> serde_json::Value {
    serde_json::json!({})
}

async fn create_deployment(
    State(s): State<AppState>,
    Json(body): Json<CreateDeploymentRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match iac::create_deployment(pool, &id, "default", &body.template_id, &body.config).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Repo config (stub)
// ============================================================

async fn get_repo_config(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "url": null,
        "branch": "main",
        "path": "iac/",
        "stub": true
    }))
}
