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

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
