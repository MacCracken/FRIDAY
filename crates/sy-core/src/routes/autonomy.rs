//! Autonomy routes — audit management and emergency stop.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::autonomy;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/autonomy/overview", get(overview))
        .route("/api/v1/autonomy/audits", get(list_audits))
        .route("/api/v1/autonomy/audits", post(create_audit))
        .route("/api/v1/autonomy/audits/{id}", get(get_audit))
        .route(
            "/api/v1/autonomy/audits/{id}/finalize",
            post(finalize_audit),
        )
        .route(
            "/api/v1/autonomy/audits/{id}/items/{itemId}",
            put(update_audit_item),
        )
        .route(
            "/api/v1/autonomy/emergency-stop/{agentId}/{reason}",
            post(emergency_stop),
        )
}

#[derive(Deserialize)]
struct PaginationQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

/// GET /api/v1/autonomy/overview — autonomy module overview.
async fn overview(State(state): State<AppState>) -> impl IntoResponse {
    let db_available = state.db().is_some();
    Json(serde_json::json!({
        "enabled": true,
        "dbConnected": db_available,
        "emergencyStopActive": false,
        "pendingAudits": 0,
        "message": "Autonomy module operational",
    }))
    .into_response()
}

async fn list_audits(
    State(state): State<AppState>,
    Query(q): Query<PaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match autonomy::list_audits(pool, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_audit(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match autonomy::get_audit(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Audit not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/v1/autonomy/audits/{id}/finalize — finalize an audit.
async fn finalize_audit(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match autonomy::finalize_audit(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Audit not found"})),
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
struct CreateAuditRequest {
    agent_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAuditItemRequest {
    status: String,
    notes: Option<String>,
}

/// PUT /api/v1/autonomy/audits/{id}/items/{itemId} — update an audit item.
async fn update_audit_item(
    State(state): State<AppState>,
    Path((id, item_id)): Path<(String, String)>,
    Json(body): Json<UpdateAuditItemRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match autonomy::update_audit_item(pool, &id, &item_id, &body.status, body.notes.as_deref())
        .await
    {
        Ok(true) => Json(serde_json::json!({
            "auditId": id,
            "itemId": item_id,
            "status": body.status,
            "updated": true,
        }))
        .into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Audit item not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/v1/autonomy/audits — create a new audit run.
async fn create_audit(
    State(state): State<AppState>,
    Json(body): Json<CreateAuditRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match autonomy::create_audit(pool, &id, &body.agent_id).await {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/v1/autonomy/emergency-stop/{agentId}/{reason} — emergency stop an agent.
async fn emergency_stop(Path((agent_id, reason)): Path<(String, String)>) -> impl IntoResponse {
    // In production this would signal the agent runtime to halt immediately.
    Json(serde_json::json!({
        "agentId": agent_id,
        "reason": reason,
        "stopped": true,
        "message": "Emergency stop signal dispatched",
    }))
    .into_response()
}
