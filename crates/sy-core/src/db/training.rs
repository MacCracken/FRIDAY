//! Training storage — jobs, datasets, experiments.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DistillationJobRow {
    pub id: String,
    pub status: String,
    pub teacher_model: Option<String>,
    pub student_model: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FinetuneJobRow {
    pub id: String,
    pub status: String,
    pub base_model: Option<String>,
    pub method: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TrainingJobRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub job_type: String,
    pub base_model: Option<String>,
    pub config_json: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AbTestRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub variant_a: String,
    pub variant_b: String,
    pub traffic_split: f64,
    pub metric: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TrainingApprovalRow {
    pub id: String,
    pub tenant_id: String,
    pub job_id: String,
    pub status: String,
    pub requested_by: String,
    pub reviewed_by: Option<String>,
    pub reason: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CuratedDatasetRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub source: String,
    pub record_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_distillation_jobs(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<DistillationJobRow>, sqlx::Error> {
    sqlx::query_as::<_, DistillationJobRow>("SELECT id, status, teacher_model, student_model, created_at, updated_at FROM training.distillation_jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2")
        .bind(limit).bind(offset).fetch_all(pool).await
}

pub async fn create_distillation_job(
    pool: &PgPool,
    id: &str,
    teacher_model: Option<&str>,
    student_model: Option<&str>,
) -> Result<DistillationJobRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, DistillationJobRow>(
        "INSERT INTO training.distillation_jobs (id, status, teacher_model, student_model, created_at, updated_at) VALUES ($1, 'pending', $2, $3, $4, $4) RETURNING *",
    )
    .bind(id).bind(teacher_model).bind(student_model).bind(now)
    .fetch_one(pool).await
}

pub async fn list_finetune_jobs(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<FinetuneJobRow>, sqlx::Error> {
    sqlx::query_as::<_, FinetuneJobRow>("SELECT id, status, base_model, method, created_at, updated_at FROM training.finetune_jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2")
        .bind(limit).bind(offset).fetch_all(pool).await
}

pub async fn list_training_jobs(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<TrainingJobRow>, sqlx::Error> {
    sqlx::query_as::<_, TrainingJobRow>(
        "SELECT * FROM training.jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id).bind(limit).bind(offset)
    .fetch_all(pool).await
}

pub async fn get_training_job(
    pool: &PgPool,
    id: &str,
) -> Result<Option<TrainingJobRow>, sqlx::Error> {
    sqlx::query_as::<_, TrainingJobRow>("SELECT * FROM training.jobs WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_training_job(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    job_type: &str,
    base_model: Option<&str>,
    config_json: &serde_json::Value,
) -> Result<TrainingJobRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, TrainingJobRow>(
        "INSERT INTO training.jobs (id, tenant_id, name, status, job_type, base_model, config_json, created_at, updated_at) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $7) RETURNING *",
    )
    .bind(id).bind(tenant_id).bind(name).bind(job_type).bind(base_model).bind(config_json).bind(now)
    .fetch_one(pool).await
}

pub async fn cancel_training_job(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let result = sqlx::query(
        "UPDATE training.jobs SET status = 'cancelled', updated_at = $1 WHERE id = $2 AND status IN ('pending', 'running')",
    )
    .bind(now).bind(id)
    .execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

pub async fn list_ab_tests(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<AbTestRow>, sqlx::Error> {
    sqlx::query_as::<_, AbTestRow>(
        "SELECT * FROM training.ab_tests WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id).bind(limit).bind(offset)
    .fetch_all(pool).await
}

pub async fn get_ab_test(pool: &PgPool, id: &str) -> Result<Option<AbTestRow>, sqlx::Error> {
    sqlx::query_as::<_, AbTestRow>("SELECT * FROM training.ab_tests WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_ab_test(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    variant_a: &str,
    variant_b: &str,
    traffic_split: f64,
    metric: &str,
) -> Result<AbTestRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AbTestRow>(
        "INSERT INTO training.ab_tests (id, tenant_id, name, status, variant_a, variant_b, traffic_split, metric, created_at, updated_at) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $8) RETURNING *",
    )
    .bind(id).bind(tenant_id).bind(name).bind(variant_a).bind(variant_b).bind(traffic_split).bind(metric).bind(now)
    .fetch_one(pool).await
}

pub async fn cancel_ab_test(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let result = sqlx::query(
        "UPDATE training.ab_tests SET status = 'cancelled', updated_at = $1 WHERE id = $2 AND status IN ('pending', 'running')",
    )
    .bind(now).bind(id)
    .execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

pub async fn list_approvals(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<TrainingApprovalRow>, sqlx::Error> {
    sqlx::query_as::<_, TrainingApprovalRow>(
        "SELECT * FROM training.approvals WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id).bind(limit).bind(offset)
    .fetch_all(pool).await
}

pub async fn approve_approval(
    pool: &PgPool,
    id: &str,
    reviewed_by: &str,
) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let result = sqlx::query(
        "UPDATE training.approvals SET status = 'approved', reviewed_by = $1, updated_at = $2 WHERE id = $3 AND status = 'pending'",
    )
    .bind(reviewed_by).bind(now).bind(id)
    .execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

pub async fn reject_approval(
    pool: &PgPool,
    id: &str,
    reviewed_by: &str,
    reason: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let result = sqlx::query(
        "UPDATE training.approvals SET status = 'rejected', reviewed_by = $1, reason = $2, updated_at = $3 WHERE id = $4 AND status = 'pending'",
    )
    .bind(reviewed_by).bind(reason).bind(now).bind(id)
    .execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

pub async fn list_curated_datasets(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<CuratedDatasetRow>, sqlx::Error> {
    sqlx::query_as::<_, CuratedDatasetRow>(
        "SELECT * FROM training.curated_datasets WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id).bind(limit).bind(offset)
    .fetch_all(pool).await
}

pub async fn create_curated_dataset(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    description: Option<&str>,
    source: &str,
) -> Result<CuratedDatasetRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, CuratedDatasetRow>(
        "INSERT INTO training.curated_datasets (id, tenant_id, name, description, source, record_count, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 0, $6, $6) RETURNING *",
    )
    .bind(id).bind(tenant_id).bind(name).bind(description).bind(source).bind(now)
    .fetch_one(pool).await
}

// ---------------------------------------------------------------------------
// Generic job row — shared by many sub-domains.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GenericJobRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub config: serde_json::Value,
    pub result: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

// ---------------------------------------------------------------------------
// Distillation — get / delete / run
// ---------------------------------------------------------------------------

pub async fn get_distillation_job(
    pool: &PgPool,
    id: &str,
) -> Result<Option<DistillationJobRow>, sqlx::Error> {
    sqlx::query_as::<_, DistillationJobRow>(
        "SELECT id, status, teacher_model, student_model, created_at, updated_at \
         FROM training.distillation_jobs WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_distillation_job(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM training.distillation_jobs WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn run_distillation_job(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let r = sqlx::query(
        "UPDATE training.distillation_jobs SET status = 'running', updated_at = $1 \
         WHERE id = $2 AND status IN ('pending', 'stopped')",
    )
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Fine-tune — create / delete / checkpoints / logs / register / resume
// ---------------------------------------------------------------------------

pub async fn create_finetune_job(
    pool: &PgPool,
    id: &str,
    base_model: Option<&str>,
    method: Option<&str>,
) -> Result<FinetuneJobRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, FinetuneJobRow>(
        "INSERT INTO training.finetune_jobs \
         (id, status, base_model, method, created_at, updated_at) \
         VALUES ($1, 'pending', $2, $3, $4, $4) RETURNING *",
    )
    .bind(id)
    .bind(base_model)
    .bind(method)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn delete_finetune_job(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM training.finetune_jobs WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn resume_finetune_job(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let r = sqlx::query(
        "UPDATE training.finetune_jobs SET status = 'running', updated_at = $1 \
         WHERE id = $2 AND status IN ('stopped', 'paused', 'failed')",
    )
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Judge / evaluation — runs & datasets (generic rows)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct JudgeRunRow {
    pub id: String,
    pub tenant_id: String,
    pub status: String,
    pub config: serde_json::Value,
    pub result: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct JudgeDatasetRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_judge_runs(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<JudgeRunRow>, sqlx::Error> {
    sqlx::query_as::<_, JudgeRunRow>(
        "SELECT * FROM training.judge_runs WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn create_judge_run(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    config: &serde_json::Value,
) -> Result<JudgeRunRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, JudgeRunRow>(
        "INSERT INTO training.judge_runs \
         (id, tenant_id, status, config, result, created_at, updated_at) \
         VALUES ($1, $2, 'pending', $3, '{}', $4, $4) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn get_judge_run(pool: &PgPool, id: &str) -> Result<Option<JudgeRunRow>, sqlx::Error> {
    sqlx::query_as::<_, JudgeRunRow>("SELECT * FROM training.judge_runs WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn delete_judge_run(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM training.judge_runs WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn list_judge_datasets(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<JudgeDatasetRow>, sqlx::Error> {
    sqlx::query_as::<_, JudgeDatasetRow>(
        "SELECT * FROM training.judge_datasets WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn create_judge_dataset(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    config: &serde_json::Value,
) -> Result<JudgeDatasetRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, JudgeDatasetRow>(
        "INSERT INTO training.judge_datasets \
         (id, tenant_id, name, config, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn get_judge_dataset(
    pool: &PgPool,
    id: &str,
) -> Result<Option<JudgeDatasetRow>, sqlx::Error> {
    sqlx::query_as::<_, JudgeDatasetRow>("SELECT * FROM training.judge_datasets WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn delete_judge_dataset(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM training.judge_datasets WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LineageRow {
    pub id: String,
    pub tenant_id: String,
    pub run_id: String,
    pub data: serde_json::Value,
    pub created_at: i64,
}

pub async fn list_lineage(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<LineageRow>, sqlx::Error> {
    sqlx::query_as::<_, LineageRow>(
        "SELECT * FROM training.lineage WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_lineage_for_run(
    pool: &PgPool,
    run_id: &str,
) -> Result<Vec<LineageRow>, sqlx::Error> {
    sqlx::query_as::<_, LineageRow>(
        "SELECT * FROM training.lineage WHERE run_id = $1 ORDER BY created_at ASC",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceRow {
    pub id: String,
    pub tenant_id: String,
    pub data: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_preference(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    data: &serde_json::Value,
) -> Result<PreferenceRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, PreferenceRow>(
        "INSERT INTO training.preferences \
         (id, tenant_id, data, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $4) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(data)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_preferences(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<PreferenceRow>, sqlx::Error> {
    sqlx::query_as::<_, PreferenceRow>(
        "SELECT * FROM training.preferences WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn delete_preference(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM training.preferences WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Quality scores
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct QualityScoreRow {
    pub id: String,
    pub tenant_id: String,
    pub score: f64,
    pub details: serde_json::Value,
    pub created_at: i64,
}

pub async fn create_quality_score(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    score: f64,
    details: &serde_json::Value,
) -> Result<QualityScoreRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, QualityScoreRow>(
        "INSERT INTO training.quality_scores \
         (id, tenant_id, score, details, created_at) \
         VALUES ($1, $2, $3, $4, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(score)
    .bind(details)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_quality_scores(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<QualityScoreRow>, sqlx::Error> {
    sqlx::query_as::<_, QualityScoreRow>(
        "SELECT * FROM training.quality_scores WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_experiment(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    config: &serde_json::Value,
) -> Result<ExperimentRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ExperimentRow>(
        "INSERT INTO training.experiments \
         (id, tenant_id, name, status, config, created_at, updated_at) \
         VALUES ($1, $2, $3, 'pending', $4, $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_experiments(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ExperimentRow>, sqlx::Error> {
    sqlx::query_as::<_, ExperimentRow>(
        "SELECT * FROM training.experiments WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_experiment(pool: &PgPool, id: &str) -> Result<Option<ExperimentRow>, sqlx::Error> {
    sqlx::query_as::<_, ExperimentRow>("SELECT * FROM training.experiments WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn update_experiment(
    pool: &PgPool,
    id: &str,
    name: Option<&str>,
    status: Option<&str>,
    config: Option<&serde_json::Value>,
) -> Result<Option<ExperimentRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ExperimentRow>(
        "UPDATE training.experiments \
         SET name = COALESCE($1, name), \
             status = COALESCE($2, status), \
             config = COALESCE($3, config), \
             updated_at = $4 \
         WHERE id = $5 RETURNING *",
    )
    .bind(name)
    .bind(status)
    .bind(config)
    .bind(now)
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_experiment(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM training.experiments WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Hyperparameter searches
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HyperparamSearchRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub config: serde_json::Value,
    pub result: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_hyperparam_search(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    config: &serde_json::Value,
) -> Result<HyperparamSearchRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, HyperparamSearchRow>(
        "INSERT INTO training.hyperparam_searches \
         (id, tenant_id, name, status, config, result, created_at, updated_at) \
         VALUES ($1, $2, $3, 'pending', $4, '{}', $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_hyperparam_searches(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<HyperparamSearchRow>, sqlx::Error> {
    sqlx::query_as::<_, HyperparamSearchRow>(
        "SELECT * FROM training.hyperparam_searches WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_hyperparam_search(
    pool: &PgPool,
    id: &str,
) -> Result<Option<HyperparamSearchRow>, sqlx::Error> {
    sqlx::query_as::<_, HyperparamSearchRow>(
        "SELECT * FROM training.hyperparam_searches WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_hyperparam_search(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM training.hyperparam_searches WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn start_hyperparam_search(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let r = sqlx::query(
        "UPDATE training.hyperparam_searches SET status = 'running', updated_at = $1 \
         WHERE id = $2 AND status = 'pending'",
    )
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Model versions
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ModelVersionRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub version: String,
    pub metadata: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_model_version(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    version: &str,
    metadata: &serde_json::Value,
) -> Result<ModelVersionRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ModelVersionRow>(
        "INSERT INTO training.model_versions \
         (id, tenant_id, name, version, metadata, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(version)
    .bind(metadata)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_model_versions(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ModelVersionRow>, sqlx::Error> {
    sqlx::query_as::<_, ModelVersionRow>(
        "SELECT * FROM training.model_versions WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_model_version(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ModelVersionRow>, sqlx::Error> {
    sqlx::query_as::<_, ModelVersionRow>("SELECT * FROM training.model_versions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

// ---------------------------------------------------------------------------
// Curated datasets — get / delete
// ---------------------------------------------------------------------------

pub async fn get_curated_dataset(
    pool: &PgPool,
    id: &str,
) -> Result<Option<CuratedDatasetRow>, sqlx::Error> {
    sqlx::query_as::<_, CuratedDatasetRow>("SELECT * FROM training.curated_datasets WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn delete_curated_dataset(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM training.curated_datasets WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// A/B tests — complete / evaluate actions
// ---------------------------------------------------------------------------

pub async fn complete_ab_test(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let r = sqlx::query(
        "UPDATE training.ab_tests SET status = 'completed', updated_at = $1 \
         WHERE id = $2 AND status = 'running'",
    )
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Computer-use episodes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseEpisodeRow {
    pub id: String,
    pub tenant_id: String,
    pub status: String,
    pub data: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_computer_use_episode(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    data: &serde_json::Value,
) -> Result<ComputerUseEpisodeRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ComputerUseEpisodeRow>(
        "INSERT INTO training.computer_use_episodes \
         (id, tenant_id, status, data, created_at, updated_at) \
         VALUES ($1, $2, 'pending', $3, $4, $4) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(data)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_computer_use_episodes(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ComputerUseEpisodeRow>, sqlx::Error> {
    sqlx::query_as::<_, ComputerUseEpisodeRow>(
        "SELECT * FROM training.computer_use_episodes WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn delete_computer_use_episode(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM training.computer_use_episodes WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Pretrain jobs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PretrainJobRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub config: serde_json::Value,
    pub progress: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_pretrain_jobs(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<PretrainJobRow>, sqlx::Error> {
    sqlx::query_as::<_, PretrainJobRow>(
        "SELECT * FROM training.pretrain_jobs WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_pretrain_job(
    pool: &PgPool,
    id: &str,
) -> Result<Option<PretrainJobRow>, sqlx::Error> {
    sqlx::query_as::<_, PretrainJobRow>("SELECT * FROM training.pretrain_jobs WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_pretrain_job(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    config: &serde_json::Value,
) -> Result<PretrainJobRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, PretrainJobRow>(
        "INSERT INTO training.pretrain_jobs \
         (id, tenant_id, name, status, config, progress, created_at, updated_at) \
         VALUES ($1, $2, $3, 'pending', $4, 0.0, $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn cancel_pretrain_job(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let r = sqlx::query(
        "UPDATE training.pretrain_jobs SET status = 'cancelled', updated_at = $1 \
         WHERE id = $2 AND status IN ('pending', 'running')",
    )
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete_pretrain_job(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM training.pretrain_jobs WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn update_pretrain_progress(
    pool: &PgPool,
    id: &str,
    progress: f64,
) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let r = sqlx::query(
        "UPDATE training.pretrain_jobs SET progress = $1, updated_at = $2 WHERE id = $3",
    )
    .bind(progress)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Dataset refresh jobs (continual learning)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DatasetRefreshJobRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_dataset_refresh_job(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    config: &serde_json::Value,
) -> Result<DatasetRefreshJobRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, DatasetRefreshJobRow>(
        "INSERT INTO training.dataset_refresh_jobs \
         (id, tenant_id, name, status, config, created_at, updated_at) \
         VALUES ($1, $2, $3, 'pending', $4, $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_dataset_refresh_jobs(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<DatasetRefreshJobRow>, sqlx::Error> {
    sqlx::query_as::<_, DatasetRefreshJobRow>(
        "SELECT * FROM training.dataset_refresh_jobs WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn run_dataset_refresh_job(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let now = now_ms();
    let r = sqlx::query(
        "UPDATE training.dataset_refresh_jobs SET status = 'running', updated_at = $1 \
         WHERE id = $2 AND status = 'pending'",
    )
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn delete_dataset_refresh_job(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM training.dataset_refresh_jobs WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// ---------------------------------------------------------------------------
// Drift detection baselines
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DriftBaselineRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DriftSnapshotRow {
    pub id: String,
    pub baseline_id: String,
    pub data: serde_json::Value,
    pub created_at: i64,
}

pub async fn create_drift_baseline(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    config: &serde_json::Value,
) -> Result<DriftBaselineRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, DriftBaselineRow>(
        "INSERT INTO training.drift_baselines \
         (id, tenant_id, name, config, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_drift_baselines(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<DriftBaselineRow>, sqlx::Error> {
    sqlx::query_as::<_, DriftBaselineRow>(
        "SELECT * FROM training.drift_baselines WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn list_drift_snapshots(
    pool: &PgPool,
    baseline_id: &str,
) -> Result<Vec<DriftSnapshotRow>, sqlx::Error> {
    sqlx::query_as::<_, DriftSnapshotRow>(
        "SELECT * FROM training.drift_snapshots WHERE baseline_id = $1 \
         ORDER BY created_at ASC",
    )
    .bind(baseline_id)
    .fetch_all(pool)
    .await
}

// ---------------------------------------------------------------------------
// Online updates
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OnlineUpdateRow {
    pub id: String,
    pub tenant_id: String,
    pub status: String,
    pub data: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_online_update(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    data: &serde_json::Value,
) -> Result<OnlineUpdateRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, OnlineUpdateRow>(
        "INSERT INTO training.online_updates \
         (id, tenant_id, status, data, created_at, updated_at) \
         VALUES ($1, $2, 'pending', $3, $4, $4) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(data)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_online_updates(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<OnlineUpdateRow>, sqlx::Error> {
    sqlx::query_as::<_, OnlineUpdateRow>(
        "SELECT * FROM training.online_updates WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_online_update(
    pool: &PgPool,
    id: &str,
) -> Result<Option<OnlineUpdateRow>, sqlx::Error> {
    sqlx::query_as::<_, OnlineUpdateRow>("SELECT * FROM training.online_updates WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
