//! Training routes — distillation, finetune jobs, A/B tests, approvals, datasets.

use crate::db::training;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/training/jobs", get(list_training_jobs))
        .route("/api/v1/training/jobs", post(create_training_job))
        .route("/api/v1/training/jobs/{id}", get(get_training_job))
        .route(
            "/api/v1/training/jobs/{id}/cancel",
            post(cancel_training_job),
        )
        .route("/api/v1/training/distillation/jobs", get(list_distillation))
        .route(
            "/api/v1/training/distillation/jobs",
            post(create_distillation),
        )
        .route("/api/v1/training/finetune/jobs", get(list_finetune))
        .route("/api/v1/training/ab-tests", get(list_ab_tests))
        .route("/api/v1/training/ab-tests", post(create_ab_test))
        .route("/api/v1/training/ab-tests/{id}", get(get_ab_test))
        .route(
            "/api/v1/training/ab-tests/{id}/cancel",
            post(cancel_ab_test),
        )
        .route("/api/v1/training/approvals", get(list_approvals))
        .route(
            "/api/v1/training/approvals/{id}/approve",
            post(approve_approval),
        )
        .route(
            "/api/v1/training/approvals/{id}/reject",
            post(reject_approval),
        )
        .route(
            "/api/v1/training/curated-datasets",
            get(list_curated_datasets),
        )
        .route(
            "/api/v1/training/curated-datasets",
            post(create_curated_dataset),
        )
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

// --- Training jobs ---

async fn list_training_jobs(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match training::list_training_jobs(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_training_job(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match training::get_training_job(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Training job not found"})),
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
struct CreateTrainingJobRequest {
    name: String,
    job_type: String,
    base_model: Option<String>,
    #[serde(default = "empty_obj")]
    config_json: serde_json::Value,
}
fn empty_obj() -> serde_json::Value {
    serde_json::json!({})
}

async fn create_training_job(
    State(s): State<AppState>,
    Json(body): Json<CreateTrainingJobRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_training_job(
        pool,
        &id,
        "default",
        &body.name,
        &body.job_type,
        body.base_model.as_deref(),
        &body.config_json,
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

async fn cancel_training_job(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::cancel_training_job(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Job not found or not cancellable"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Distillation ---

async fn list_distillation(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match training::list_distillation_jobs(pool, q.limit.min(100), q.offset).await {
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
struct CreateDistillationRequest {
    teacher_model: Option<String>,
    student_model: Option<String>,
}

async fn create_distillation(
    State(s): State<AppState>,
    Json(body): Json<CreateDistillationRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_distillation_job(
        pool,
        &id,
        body.teacher_model.as_deref(),
        body.student_model.as_deref(),
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

async fn list_finetune(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match training::list_finetune_jobs(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- A/B tests ---

async fn list_ab_tests(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match training::list_ab_tests(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_ab_test(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match training::get_ab_test(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "A/B test not found"})),
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
struct CreateAbTestRequest {
    name: String,
    variant_a: String,
    variant_b: String,
    #[serde(default = "default_split")]
    traffic_split: f64,
    #[serde(default = "default_metric")]
    metric: String,
}
fn default_split() -> f64 {
    0.5
}
fn default_metric() -> String {
    "accuracy".to_string()
}

async fn create_ab_test(
    State(s): State<AppState>,
    Json(body): Json<CreateAbTestRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_ab_test(
        pool,
        &id,
        "default",
        &body.name,
        &body.variant_a,
        &body.variant_b,
        body.traffic_split,
        &body.metric,
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

async fn cancel_ab_test(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::cancel_ab_test(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "A/B test not found or not cancellable"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Approvals ---

async fn list_approvals(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match training::list_approvals(pool, "default", q.limit.min(100), q.offset).await {
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
struct ApprovalActionRequest {
    reviewed_by: String,
    reason: Option<String>,
}

async fn approve_approval(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ApprovalActionRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::approve_approval(pool, &id, &body.reviewed_by).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Approval not found or already reviewed"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn reject_approval(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ApprovalActionRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::reject_approval(pool, &id, &body.reviewed_by, body.reason.as_deref()).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Approval not found or already reviewed"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Curated datasets ---

async fn list_curated_datasets(
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
    match training::list_curated_datasets(pool, "default", q.limit.min(100), q.offset).await {
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
struct CreateCuratedDatasetRequest {
    name: String,
    description: Option<String>,
    #[serde(default = "default_source")]
    source: String,
}
fn default_source() -> String {
    "upload".to_string()
}

async fn create_curated_dataset(
    State(s): State<AppState>,
    Json(body): Json<CreateCuratedDatasetRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_curated_dataset(
        pool,
        &id,
        "default",
        &body.name,
        body.description.as_deref(),
        &body.source,
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
