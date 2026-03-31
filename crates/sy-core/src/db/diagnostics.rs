//! Diagnostics storage — agent reports via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReportRow {
    pub id: String,
    pub agent_id: Option<String>,
    pub report_type: String,
    pub summary: Option<String>,
    pub details: serde_json::Value,
    pub status: String,
    pub created_at: i64,
}

pub async fn list_reports(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<DiagnosticReportRow>, sqlx::Error> {
    sqlx::query_as::<_, DiagnosticReportRow>(
        "SELECT * FROM diagnostics.agent_reports ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_report(
    pool: &PgPool,
    id: &str,
) -> Result<Option<DiagnosticReportRow>, sqlx::Error> {
    sqlx::query_as::<_, DiagnosticReportRow>(
        "SELECT * FROM diagnostics.agent_reports WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}
