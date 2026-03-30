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

pub async fn list_distillation_jobs(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<DistillationJobRow>, sqlx::Error> {
    sqlx::query_as::<_, DistillationJobRow>("SELECT id, status, teacher_model, student_model, created_at, updated_at FROM training.distillation_jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2")
        .bind(limit).bind(offset).fetch_all(pool).await
}

pub async fn list_finetune_jobs(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<FinetuneJobRow>, sqlx::Error> {
    sqlx::query_as::<_, FinetuneJobRow>("SELECT id, status, base_model, method, created_at, updated_at FROM training.finetune_jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2")
        .bind(limit).bind(offset).fetch_all(pool).await
}
