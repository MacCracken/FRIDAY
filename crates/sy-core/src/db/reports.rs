//! Reports storage — report records via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReportRow {
    pub id: String,
    pub report_type: String,
    pub title: String,
    pub status: String,
    pub parameters: serde_json::Value,
    pub result_json: Option<serde_json::Value>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

pub async fn list_reports(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ReportRow>, sqlx::Error> {
    sqlx::query_as::<_, ReportRow>(
        "SELECT * FROM reports.reports ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn list_reports_by_type(
    pool: &PgPool,
    report_type: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ReportRow>, sqlx::Error> {
    sqlx::query_as::<_, ReportRow>(
        "SELECT * FROM reports.reports WHERE report_type = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(report_type)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_report(pool: &PgPool, id: &str) -> Result<Option<ReportRow>, sqlx::Error> {
    sqlx::query_as::<_, ReportRow>("SELECT * FROM reports.reports WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_report(
    pool: &PgPool,
    id: &str,
    report_type: &str,
    title: &str,
    parameters: &serde_json::Value,
) -> Result<ReportRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ReportRow>(
        "INSERT INTO reports.reports (id, report_type, title, status, parameters, created_at)
         VALUES ($1, $2, $3, 'generating', $4, $5)
         RETURNING *",
    )
    .bind(id)
    .bind(report_type)
    .bind(title)
    .bind(parameters)
    .bind(now)
    .fetch_one(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
