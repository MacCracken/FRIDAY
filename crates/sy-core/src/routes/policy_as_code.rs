//! Policy-as-code routes — bundle management, sync, deploy, rollback, evaluate, repo config.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::policy_as_code;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // ── Bundles ──
        .route("/api/v1/policy-as-code/bundles", get(list_bundles))
        .route("/api/v1/policy-as-code/bundles/{bundleId}", get(get_bundle))
        .route(
            "/api/v1/policy-as-code/bundles/{bundleId}",
            delete(delete_bundle),
        )
        // ── Sync ──
        .route("/api/v1/policy-as-code/sync", post(sync_bundles))
        // ── Deploy ──
        .route(
            "/api/v1/policy-as-code/bundles/{bundleName}/deploy",
            post(deploy_bundle),
        )
        // ── Deployments ──
        .route("/api/v1/policy-as-code/deployments", get(list_deployments))
        // ── Rollback ──
        .route("/api/v1/policy-as-code/rollback", post(rollback_deployment))
        // ── Evaluate ──
        .route("/api/v1/policy-as-code/evaluate", post(evaluate_policy))
        // ── Repo config ──
        .route("/api/v1/policy-as-code/repo", get(get_repo_config))
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
// Bundles
// ============================================================

async fn list_bundles(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match policy_as_code::list_bundles(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_bundle(State(s): State<AppState>, Path(bundle_id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match policy_as_code::get_bundle(pool, &bundle_id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Bundle not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_bundle(
    State(s): State<AppState>,
    Path(bundle_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match policy_as_code::delete_bundle(pool, &bundle_id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Bundle not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Sync (stub — actual logic is external)
// ============================================================

async fn sync_bundles(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "accepted",
        "message": "Bundle sync initiated"
    }))
}

// ============================================================
// Deploy
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeployBundleRequest {
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

fn empty_obj() -> serde_json::Value {
    serde_json::json!({})
}

async fn deploy_bundle(
    State(s): State<AppState>,
    Path(bundle_name): Path<String>,
    Json(body): Json<DeployBundleRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    // Look up bundle by name to get its id
    let bundle = match policy_as_code::get_bundle_by_name(pool, "default", &bundle_name).await {
        Ok(Some(b)) => b,
        Ok(None) => return not_found("Bundle not found").into_response(),
        Err(e) => return db_err(e).into_response(),
    };
    let id = uuid::Uuid::now_v7().to_string();
    match policy_as_code::create_deployment(
        pool,
        &id,
        "default",
        &bundle.id,
        &bundle_name,
        &body.config,
    )
    .await
    {
        Ok(r) => (StatusCode::ACCEPTED, Json(serde_json::to_value(r).unwrap())).into_response(),
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
    match policy_as_code::list_deployments(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Rollback
// ============================================================

async fn rollback_deployment(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match policy_as_code::rollback_latest_deployment(pool, "default").await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("No active deployment to roll back").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Evaluate (stub — OPA/CEL evaluation is external)
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvaluatePolicyRequest {
    #[serde(default)]
    bundle_id: Option<String>,
    #[serde(default = "empty_obj")]
    input: serde_json::Value,
    #[serde(default)]
    query: Option<String>,
}

async fn evaluate_policy(
    State(_s): State<AppState>,
    Json(_body): Json<EvaluatePolicyRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "result": null,
        "allow": false,
        "reasons": [],
        "stub": true
    }))
}

// ============================================================
// Repo config (stub)
// ============================================================

async fn get_repo_config(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "url": null,
        "branch": "main",
        "path": "policies/",
        "stub": true
    }))
}
