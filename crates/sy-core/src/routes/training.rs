//! Training routes — distillation, finetune jobs, A/B tests, approvals, datasets,
//! judge/evaluation, lineage, preferences, quality, experiments, hyperparameter
//! search, model versions, computer use, deployment, pretrain, continual learning,
//! and streaming stubs.

use crate::db::training;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new()
        // --- Core training jobs ---
        .route("/api/v1/training/jobs", get(list_training_jobs))
        .route("/api/v1/training/jobs", post(create_training_job))
        .route("/api/v1/training/jobs/{id}", get(get_training_job))
        .route(
            "/api/v1/training/jobs/{id}/cancel",
            post(cancel_training_job),
        )
        // --- Export & stats ---
        .route("/api/v1/training/export", post(export_training_data))
        .route("/api/v1/training/stats", get(get_training_stats))
        .route("/api/v1/training/stream", get(training_stream))
        // --- Distillation ---
        .route("/api/v1/training/distillation/jobs", get(list_distillation))
        .route(
            "/api/v1/training/distillation/jobs",
            post(create_distillation),
        )
        .route(
            "/api/v1/training/distillation/jobs/{id}",
            get(get_distillation_job),
        )
        .route(
            "/api/v1/training/distillation/jobs/{id}",
            delete(delete_distillation_job),
        )
        .route(
            "/api/v1/training/distillation/jobs/{id}/run",
            post(run_distillation_job),
        )
        // --- Fine-tuning ---
        .route("/api/v1/training/finetune/jobs", get(list_finetune))
        .route("/api/v1/training/finetune/jobs", post(create_finetune_job))
        .route(
            "/api/v1/training/finetune/jobs/{id}",
            delete(delete_finetune_job),
        )
        .route(
            "/api/v1/training/finetune/jobs/{id}/checkpoints",
            get(get_finetune_checkpoints),
        )
        .route(
            "/api/v1/training/finetune/jobs/{id}/logs",
            get(get_finetune_logs),
        )
        .route(
            "/api/v1/training/finetune/jobs/{id}/register",
            post(register_finetune_model),
        )
        .route(
            "/api/v1/training/finetune/jobs/{id}/resume",
            post(resume_finetune_job),
        )
        // --- Judge / evaluation ---
        .route("/api/v1/training/judge/auto-eval", post(judge_auto_eval))
        .route("/api/v1/training/judge/pointwise", post(judge_pointwise))
        .route("/api/v1/training/judge/pairwise", post(judge_pairwise))
        .route("/api/v1/training/judge/runs", get(list_judge_runs))
        .route("/api/v1/training/judge/runs", post(create_judge_run))
        .route("/api/v1/training/judge/runs/{id}", get(get_judge_run))
        .route("/api/v1/training/judge/runs/{id}", delete(delete_judge_run))
        .route("/api/v1/training/judge/datasets", get(list_judge_datasets))
        .route(
            "/api/v1/training/judge/datasets",
            post(create_judge_dataset),
        )
        .route(
            "/api/v1/training/judge/datasets/{id}",
            get(get_judge_dataset),
        )
        .route(
            "/api/v1/training/judge/datasets/{id}",
            delete(delete_judge_dataset),
        )
        .route(
            "/api/v1/training/judge/comparisons",
            get(list_judge_comparisons),
        )
        // --- Lineage ---
        .route("/api/v1/training/lineage", get(list_lineage))
        .route("/api/v1/training/lineage/{runId}", get(get_lineage_for_run))
        // --- Preferences ---
        .route("/api/v1/training/preferences", post(create_preference))
        .route("/api/v1/training/preferences", get(list_preferences))
        .route(
            "/api/v1/training/preferences/{id}",
            delete(delete_preference),
        )
        .route(
            "/api/v1/training/preferences/export",
            post(export_preferences),
        )
        .route(
            "/api/v1/training/preference-pairs/export-file",
            post(export_preference_pairs_file),
        )
        // --- Quality & side-by-side ---
        .route("/api/v1/training/quality/score", post(score_quality))
        .route("/api/v1/training/quality", get(list_quality_scores))
        .route("/api/v1/training/side-by-side/rate", get(get_sbs_ratings))
        // --- Experiments ---
        .route("/api/v1/training/experiments", post(create_experiment))
        .route("/api/v1/training/experiments", get(list_experiments))
        .route(
            "/api/v1/training/experiments/{id}",
            get(get_experiment_by_id),
        )
        .route(
            "/api/v1/training/experiments/{id}",
            patch(update_experiment),
        )
        .route(
            "/api/v1/training/experiments/{id}",
            delete(delete_experiment),
        )
        // --- Hyperparameter search ---
        .route(
            "/api/v1/training/hyperparam/searches",
            post(create_hyperparam_search),
        )
        .route(
            "/api/v1/training/hyperparam/searches",
            get(list_hyperparam_searches),
        )
        .route(
            "/api/v1/training/hyperparam/searches/{id}",
            get(get_hyperparam_search),
        )
        .route(
            "/api/v1/training/hyperparam/searches/{id}",
            delete(delete_hyperparam_search),
        )
        .route(
            "/api/v1/training/hyperparam/searches/{id}/start",
            post(start_hyperparam_search),
        )
        // --- Model versions ---
        .route(
            "/api/v1/training/model-versions",
            post(create_model_version),
        )
        .route("/api/v1/training/model-versions", get(list_model_versions))
        .route(
            "/api/v1/training/model-versions/{id}",
            get(get_model_version),
        )
        // --- A/B tests ---
        .route("/api/v1/training/ab-tests", get(list_ab_tests))
        .route("/api/v1/training/ab-tests", post(create_ab_test))
        .route("/api/v1/training/ab-tests/{id}", get(get_ab_test))
        .route(
            "/api/v1/training/ab-tests/{id}/cancel",
            post(cancel_ab_test),
        )
        .route(
            "/api/v1/training/ab-tests/{id}/complete",
            post(complete_ab_test),
        )
        .route(
            "/api/v1/training/ab-tests/{id}/evaluate",
            post(evaluate_ab_test),
        )
        // --- Curated datasets ---
        .route(
            "/api/v1/training/curated-datasets",
            get(list_curated_datasets),
        )
        .route(
            "/api/v1/training/curated-datasets",
            post(create_curated_dataset),
        )
        .route(
            "/api/v1/training/curated-datasets/{id}",
            get(get_curated_dataset),
        )
        .route(
            "/api/v1/training/curated-datasets/{id}",
            delete(delete_curated_dataset),
        )
        .route(
            "/api/v1/training/curated-datasets/preview",
            post(preview_curated_dataset),
        )
        // --- Approvals ---
        .route("/api/v1/training/approvals", get(list_approvals))
        .route(
            "/api/v1/training/approvals/{id}/approve",
            post(approve_approval),
        )
        .route(
            "/api/v1/training/approvals/{id}/reject",
            post(reject_approval),
        )
        // --- Computer use ---
        .route(
            "/api/v1/training/computer-use/episodes",
            post(create_computer_use_episode),
        )
        .route(
            "/api/v1/training/computer-use/episodes",
            get(list_computer_use_episodes),
        )
        .route(
            "/api/v1/training/computer-use/stats",
            get(get_computer_use_stats),
        )
        .route(
            "/api/v1/training/computer-use/episodes/{id}",
            delete(delete_computer_use_episode),
        )
        // --- Deployment ---
        .route("/api/v1/training/deploy", post(deploy_model))
        .route(
            "/api/v1/training/deploy/rollback",
            post(rollback_deployment),
        )
        // --- Pretrain ---
        .route("/api/v1/training/pretrain/jobs", get(list_pretrain_jobs))
        .route("/api/v1/training/pretrain/jobs", post(create_pretrain_job))
        .route(
            "/api/v1/training/pretrain/jobs/{jobId}",
            get(get_pretrain_job),
        )
        .route(
            "/api/v1/training/pretrain/jobs/{jobId}/cancel",
            post(cancel_pretrain_job),
        )
        .route(
            "/api/v1/training/pretrain/jobs/{jobId}",
            delete(delete_pretrain_job),
        )
        .route(
            "/api/v1/training/pretrain/jobs/{jobId}/progress",
            post(report_pretrain_progress),
        )
        .route(
            "/api/v1/training/pretrain/corpus",
            get(list_pretrain_corpus),
        )
        .route(
            "/api/v1/training/pretrain/corpus/validate",
            post(validate_pretrain_corpus),
        )
        .route(
            "/api/v1/training/pretrain/corpus/stats",
            get(pretrain_corpus_stats),
        )
        // --- Dataset refresh (continual learning) ---
        .route(
            "/api/v1/training/dataset-refresh/jobs",
            post(create_dataset_refresh_job),
        )
        .route(
            "/api/v1/training/dataset-refresh/jobs",
            get(list_dataset_refresh_jobs),
        )
        .route(
            "/api/v1/training/dataset-refresh/jobs/{id}/run",
            post(run_dataset_refresh_job),
        )
        .route(
            "/api/v1/training/dataset-refresh/jobs/{id}",
            delete(delete_dataset_refresh_job),
        )
        // --- Drift detection ---
        .route(
            "/api/v1/training/drift/baselines",
            post(create_drift_baseline),
        )
        .route(
            "/api/v1/training/drift/baselines",
            get(list_drift_baselines),
        )
        .route(
            "/api/v1/training/drift/baselines/{id}/snapshots",
            get(list_drift_snapshots),
        )
        .route("/api/v1/training/drift/check", post(check_drift))
        // --- Online updates ---
        .route(
            "/api/v1/training/online-updates",
            post(create_online_update),
        )
        .route("/api/v1/training/online-updates", get(list_online_updates))
        .route(
            "/api/v1/training/online-updates/{id}",
            get(get_online_update),
        )
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

fn empty_obj() -> serde_json::Value {
    serde_json::json!({})
}

// ============================================================
// Core training jobs
// ============================================================

async fn list_training_jobs(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_training_jobs(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_training_job(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_training_job(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Training job not found").into_response(),
        Err(e) => db_err(e).into_response(),
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

async fn create_training_job(
    State(s): State<AppState>,
    Json(body): Json<CreateTrainingJobRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
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
        Err(e) => db_err(e).into_response(),
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
        Ok(false) => not_found("Job not found or not cancellable").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Export & stats (placeholder)
// ============================================================

async fn export_training_data(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "accepted",
        "message": "Export initiated (streaming stub)"
    }))
}

async fn get_training_stats(State(s): State<AppState>) -> impl IntoResponse {
    let Some(_pool) = s.db() else {
        return no_db().into_response();
    };
    Json(serde_json::json!({
        "totalJobs": 0,
        "runningJobs": 0,
        "completedJobs": 0,
        "failedJobs": 0
    }))
    .into_response()
}

async fn training_stream(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "stub",
        "message": "SSE stream not yet implemented"
    }))
}

// ============================================================
// Distillation
// ============================================================

async fn list_distillation(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_distillation_jobs(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
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
        return no_db().into_response();
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
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_distillation_job(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_distillation_job(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Distillation job not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_distillation_job(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::delete_distillation_job(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Distillation job not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn run_distillation_job(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::run_distillation_job(pool, &id).await {
        Ok(true) => Json(serde_json::json!({"id": id, "status": "running"})).into_response(),
        Ok(false) => not_found("Distillation job not found or not runnable").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Fine-tuning
// ============================================================

async fn list_finetune(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_finetune_jobs(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateFinetuneRequest {
    base_model: Option<String>,
    method: Option<String>,
}

async fn create_finetune_job(
    State(s): State<AppState>,
    Json(body): Json<CreateFinetuneRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_finetune_job(
        pool,
        &id,
        body.base_model.as_deref(),
        body.method.as_deref(),
    )
    .await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_finetune_job(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::delete_finetune_job(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Finetune job not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_finetune_checkpoints(
    State(_s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    Json(serde_json::json!({"jobId": id, "checkpoints": []}))
}

async fn get_finetune_logs(
    State(_s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    Json(serde_json::json!({"jobId": id, "logs": []}))
}

async fn register_finetune_model(
    State(_s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    Json(serde_json::json!({"jobId": id, "status": "registered"}))
}

async fn resume_finetune_job(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::resume_finetune_job(pool, &id).await {
        Ok(true) => Json(serde_json::json!({"id": id, "status": "running"})).into_response(),
        Ok(false) => not_found("Finetune job not found or not resumable").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Judge / evaluation
// ============================================================

async fn judge_auto_eval(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "evalId": uuid::Uuid::now_v7().to_string(),
        "status": "completed",
        "score": 0.0
    }))
}

async fn judge_pointwise(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "evalId": uuid::Uuid::now_v7().to_string(),
        "type": "pointwise",
        "score": 0.0
    }))
}

async fn judge_pairwise(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "evalId": uuid::Uuid::now_v7().to_string(),
        "type": "pairwise",
        "preferred": "a"
    }))
}

async fn list_judge_runs(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_judge_runs(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateJudgeRunRequest {
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_judge_run(
    State(s): State<AppState>,
    Json(body): Json<CreateJudgeRunRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_judge_run(pool, &id, "default", &body.config).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_judge_run(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_judge_run(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Judge run not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_judge_run(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::delete_judge_run(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Judge run not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_judge_datasets(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_judge_datasets(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateJudgeDatasetRequest {
    name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_judge_dataset(
    State(s): State<AppState>,
    Json(body): Json<CreateJudgeDatasetRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_judge_dataset(pool, &id, "default", &body.name, &body.config).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_judge_dataset(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_judge_dataset(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Judge dataset not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_judge_dataset(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::delete_judge_dataset(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Judge dataset not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_judge_comparisons(
    State(_s): State<AppState>,
    Query(_q): Query<PQ>,
) -> impl IntoResponse {
    Json(serde_json::json!({"comparisons": []}))
}

// ============================================================
// Lineage
// ============================================================

async fn list_lineage(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_lineage(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_lineage_for_run(
    State(s): State<AppState>,
    Path(run_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_lineage_for_run(pool, &run_id).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Preferences
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePreferenceRequest {
    #[serde(default = "empty_obj")]
    data: serde_json::Value,
}

async fn create_preference(
    State(s): State<AppState>,
    Json(body): Json<CreatePreferenceRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_preference(pool, &id, "default", &body.data).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_preferences(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_preferences(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_preference(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::delete_preference(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Preference not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn export_preferences(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"status": "accepted", "message": "Export initiated"}))
}

async fn export_preference_pairs_file(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"status": "accepted", "message": "Pairs export initiated"}))
}

// ============================================================
// Quality & side-by-side
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScoreQualityRequest {
    #[serde(default)]
    score: f64,
    #[serde(default = "empty_obj")]
    details: serde_json::Value,
}

async fn score_quality(
    State(s): State<AppState>,
    Json(body): Json<ScoreQualityRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_quality_score(pool, &id, "default", body.score, &body.details).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_quality_scores(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_quality_scores(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_sbs_ratings(State(_s): State<AppState>, Query(_q): Query<PQ>) -> impl IntoResponse {
    Json(serde_json::json!({"ratings": []}))
}

// ============================================================
// Experiments
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateExperimentRequest {
    name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_experiment(
    State(s): State<AppState>,
    Json(body): Json<CreateExperimentRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_experiment(pool, &id, "default", &body.name, &body.config).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_experiments(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_experiments(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_experiment_by_id(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_experiment(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Experiment not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateExperimentRequest {
    name: Option<String>,
    status: Option<String>,
    config: Option<serde_json::Value>,
}

async fn update_experiment(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateExperimentRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::update_experiment(
        pool,
        &id,
        body.name.as_deref(),
        body.status.as_deref(),
        body.config.as_ref(),
    )
    .await
    {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Experiment not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_experiment(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::delete_experiment(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Experiment not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Hyperparameter search
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateHyperparamSearchRequest {
    name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_hyperparam_search(
    State(s): State<AppState>,
    Json(body): Json<CreateHyperparamSearchRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_hyperparam_search(pool, &id, "default", &body.name, &body.config).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_hyperparam_searches(
    State(s): State<AppState>,
    Query(q): Query<PQ>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_hyperparam_searches(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_hyperparam_search(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_hyperparam_search(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Hyperparam search not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_hyperparam_search(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::delete_hyperparam_search(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Hyperparam search not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn start_hyperparam_search(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::start_hyperparam_search(pool, &id).await {
        Ok(true) => Json(serde_json::json!({"id": id, "status": "running"})).into_response(),
        Ok(false) => not_found("Search not found or not startable").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Model versions
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateModelVersionRequest {
    name: String,
    version: String,
    #[serde(default = "empty_obj")]
    metadata: serde_json::Value,
}

async fn create_model_version(
    State(s): State<AppState>,
    Json(body): Json<CreateModelVersionRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_model_version(
        pool,
        &id,
        "default",
        &body.name,
        &body.version,
        &body.metadata,
    )
    .await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_model_versions(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_model_versions(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_model_version(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_model_version(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Model version not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// A/B tests
// ============================================================

async fn list_ab_tests(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_ab_tests(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_ab_test(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_ab_test(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("A/B test not found").into_response(),
        Err(e) => db_err(e).into_response(),
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
        return no_db().into_response();
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
        Err(e) => db_err(e).into_response(),
    }
}

async fn cancel_ab_test(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::cancel_ab_test(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("A/B test not found or not cancellable").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn complete_ab_test(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::complete_ab_test(pool, &id).await {
        Ok(true) => Json(serde_json::json!({"id": id, "status": "completed"})).into_response(),
        Ok(false) => not_found("A/B test not found or not completable").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn evaluate_ab_test(State(_s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({"testId": id, "evaluation": {}, "status": "evaluated"}))
}

// ============================================================
// Curated datasets
// ============================================================

async fn list_curated_datasets(
    State(s): State<AppState>,
    Query(q): Query<PQ>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_curated_datasets(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
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
        return no_db().into_response();
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
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_curated_dataset(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_curated_dataset(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Curated dataset not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_curated_dataset(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::delete_curated_dataset(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Curated dataset not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn preview_curated_dataset(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"preview": [], "total": 0}))
}

// ============================================================
// Approvals
// ============================================================

async fn list_approvals(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_approvals(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
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
        Ok(false) => not_found("Approval not found or already reviewed").into_response(),
        Err(e) => db_err(e).into_response(),
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
        Ok(false) => not_found("Approval not found or already reviewed").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Computer use
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateEpisodeRequest {
    #[serde(default = "empty_obj")]
    data: serde_json::Value,
}

async fn create_computer_use_episode(
    State(s): State<AppState>,
    Json(body): Json<CreateEpisodeRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_computer_use_episode(pool, &id, "default", &body.data).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_computer_use_episodes(
    State(s): State<AppState>,
    Query(q): Query<PQ>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_computer_use_episodes(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_computer_use_stats(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"totalEpisodes": 0, "completedEpisodes": 0}))
}

async fn delete_computer_use_episode(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::delete_computer_use_episode(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Episode not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Deployment (placeholder)
// ============================================================

async fn deploy_model(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "deploymentId": uuid::Uuid::now_v7().to_string(),
        "status": "deploying"
    }))
}

async fn rollback_deployment(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "rollbackId": uuid::Uuid::now_v7().to_string(),
        "status": "rolling_back"
    }))
}

// ============================================================
// Pretrain
// ============================================================

async fn list_pretrain_jobs(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_pretrain_jobs(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_pretrain_job(
    State(s): State<AppState>,
    Path(job_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_pretrain_job(pool, &job_id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Pretrain job not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePretrainJobRequest {
    name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_pretrain_job(
    State(s): State<AppState>,
    Json(body): Json<CreatePretrainJobRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_pretrain_job(pool, &id, "default", &body.name, &body.config).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn cancel_pretrain_job(
    State(s): State<AppState>,
    Path(job_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::cancel_pretrain_job(pool, &job_id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Pretrain job not found or not cancellable").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_pretrain_job(
    State(s): State<AppState>,
    Path(job_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::delete_pretrain_job(pool, &job_id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Pretrain job not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportProgressRequest {
    progress: f64,
}

async fn report_pretrain_progress(
    State(s): State<AppState>,
    Path(job_id): Path<String>,
    Json(body): Json<ReportProgressRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::update_pretrain_progress(pool, &job_id, body.progress).await {
        Ok(true) => {
            Json(serde_json::json!({"jobId": job_id, "progress": body.progress})).into_response()
        }
        Ok(false) => not_found("Pretrain job not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_pretrain_corpus(
    State(_s): State<AppState>,
    Query(_q): Query<PQ>,
) -> impl IntoResponse {
    Json(serde_json::json!({"corpus": []}))
}

async fn validate_pretrain_corpus(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"valid": true, "errors": []}))
}

async fn pretrain_corpus_stats(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({"totalDocuments": 0, "totalTokens": 0}))
}

// ============================================================
// Dataset refresh (continual learning)
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDatasetRefreshJobRequest {
    name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_dataset_refresh_job(
    State(s): State<AppState>,
    Json(body): Json<CreateDatasetRefreshJobRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_dataset_refresh_job(pool, &id, "default", &body.name, &body.config).await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_dataset_refresh_jobs(
    State(s): State<AppState>,
    Query(q): Query<PQ>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_dataset_refresh_jobs(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn run_dataset_refresh_job(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::run_dataset_refresh_job(pool, &id).await {
        Ok(true) => Json(serde_json::json!({"id": id, "status": "running"})).into_response(),
        Ok(false) => not_found("Dataset refresh job not found or not runnable").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_dataset_refresh_job(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match training::delete_dataset_refresh_job(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Dataset refresh job not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Drift detection
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDriftBaselineRequest {
    name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_drift_baseline(
    State(s): State<AppState>,
    Json(body): Json<CreateDriftBaselineRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_drift_baseline(pool, &id, "default", &body.name, &body.config).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_drift_baselines(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_drift_baselines(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_drift_snapshots(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_drift_snapshots(pool, &id).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn check_drift(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "driftDetected": false,
        "score": 0.0,
        "details": {}
    }))
}

// ============================================================
// Online updates
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateOnlineUpdateRequest {
    #[serde(default = "empty_obj")]
    data: serde_json::Value,
}

async fn create_online_update(
    State(s): State<AppState>,
    Json(body): Json<CreateOnlineUpdateRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match training::create_online_update(pool, &id, "default", &body.data).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_online_updates(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::list_online_updates(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_online_update(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match training::get_online_update(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Online update not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}
