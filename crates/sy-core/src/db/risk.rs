//! Risk assessment storage.
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentRow {
    pub id: String,
    pub name: String,
    pub status: String,
    pub score: Option<f64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_assessments(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<AssessmentRow>, sqlx::Error> {
    sqlx::query_as::<_, AssessmentRow>("SELECT id, name, status, score, created_at, updated_at FROM risk.assessments ORDER BY created_at DESC LIMIT $1")
        .bind(limit).fetch_all(pool).await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DepartmentRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: i64,
}

pub async fn list_departments(pool: &PgPool) -> Result<Vec<DepartmentRow>, sqlx::Error> {
    sqlx::query_as::<_, DepartmentRow>(
        "SELECT id, name, description, created_at FROM risk.departments ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await
}
