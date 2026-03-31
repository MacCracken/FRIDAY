//! Risk assessment storage — assessments and dashboard via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RiskAssessmentRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub severity: Option<String>,
    pub score: Option<f64>,
    pub status: String,
    pub metadata: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RiskDashboardSummary {
    pub total_assessments: i64,
    pub critical_count: i64,
    pub high_count: i64,
    pub medium_count: i64,
    pub low_count: i64,
}

pub async fn list_assessments(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<RiskAssessmentRow>, sqlx::Error> {
    sqlx::query_as::<_, RiskAssessmentRow>(
        "SELECT * FROM risk.assessments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_assessment(
    pool: &PgPool,
    id: &str,
) -> Result<Option<RiskAssessmentRow>, sqlx::Error> {
    sqlx::query_as::<_, RiskAssessmentRow>("SELECT * FROM risk.assessments WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_assessment(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    description: Option<&str>,
    category: &str,
) -> Result<RiskAssessmentRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, RiskAssessmentRow>(
        "INSERT INTO risk.assessments (id, tenant_id, name, description, category, status, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', '{}', $6, $6) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(description)
    .bind(category)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn delete_assessment(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM risk.assessments WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn update_score(
    pool: &PgPool,
    id: &str,
    score: f64,
    severity: &str,
) -> Result<Option<RiskAssessmentRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, RiskAssessmentRow>(
        "UPDATE risk.assessments SET score = $2, severity = $3, status = 'scored', updated_at = $4 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(score)
    .bind(severity)
    .bind(now)
    .fetch_optional(pool)
    .await
}

pub async fn dashboard_summary(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<RiskDashboardSummary, sqlx::Error> {
    sqlx::query_as::<_, RiskDashboardSummary>(
        "SELECT
            COUNT(*) as total_assessments,
            COUNT(*) FILTER (WHERE severity = 'critical') as critical_count,
            COUNT(*) FILTER (WHERE severity = 'high') as high_count,
            COUNT(*) FILTER (WHERE severity = 'medium') as medium_count,
            COUNT(*) FILTER (WHERE severity = 'low') as low_count
         FROM risk.assessments WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
