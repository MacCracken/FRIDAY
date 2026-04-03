//! Risk assessment routes — assessments, scoring, and dashboard.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::risk_assessment;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/risk/assessments", get(list_assessments))
        .route("/api/v1/risk/assessments", post(create_assessment))
        .route("/api/v1/risk/assessments/{id}", get(get_assessment))
        .route("/api/v1/risk/assessments/{id}", delete(delete_assessment))
        .route(
            "/api/v1/risk/assessments/{id}/score",
            post(score_assessment),
        )
        .route("/api/v1/risk/dashboard", get(risk_dashboard))
        .route("/api/v1/risk/config", get(risk_config))
        // Dashboard risk page endpoints
        .route("/api/v1/risk/departments", get(risk_departments))
        .route("/api/v1/risk/feeds", get(risk_feeds))
        .route("/api/v1/risk/findings", get(risk_findings))
        .route("/api/v1/risk/heatmap", get(risk_heatmap))
        .route("/api/v1/risk/register", get(risk_register))
        .route("/api/v1/risk/summary", get(risk_summary))
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

async fn list_assessments(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match risk_assessment::list_assessments(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAssessmentRequest {
    name: String,
    description: Option<String>,
    category: String,
}

async fn create_assessment(
    State(state): State<AppState>,
    Json(body): Json<CreateAssessmentRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match risk_assessment::create_assessment(
        pool,
        &id,
        "default",
        &body.name,
        body.description.as_deref(),
        &body.category,
    )
    .await
    {
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

async fn get_assessment(
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
    match risk_assessment::get_assessment(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Assessment not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_assessment(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match risk_assessment::delete_assessment(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Assessment not found"})),
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
struct ScoreRequest {
    score: f64,
    severity: String,
}

async fn score_assessment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ScoreRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match risk_assessment::update_score(pool, &id, body.score, &body.severity).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Assessment not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn risk_dashboard(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match risk_assessment::dashboard_summary(pool, "default").await {
        Ok(summary) => Json(serde_json::to_value(summary).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn risk_config(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "severityLevels": ["critical", "high", "medium", "low"],
        "categories": ["security", "compliance", "operational", "financial"],
        "autoScoreEnabled": false
    }))
    .into_response()
}

// ── Dashboard Risk Page Endpoints ──────────────────────────────────────

async fn risk_departments(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"items": [], "total": 0}))
}

async fn risk_feeds(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"feeds": [], "total": 0}))
}

async fn risk_findings(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"findings": [], "total": 0}))
}

async fn risk_heatmap(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"cells": [], "dimensions": {"rows": 0, "cols": 0}}))
}

async fn risk_register(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"items": [], "total": 0}))
}

async fn risk_summary(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "totalRisks": 0,
        "criticalCount": 0,
        "highCount": 0,
        "mediumCount": 0,
        "lowCount": 0,
        "mitigatedCount": 0,
        "overallScore": 0.0,
        "trend": "stable",
    }))
}
