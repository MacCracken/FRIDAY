//! Security storage — DLP, SRA, ATHI, policies.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DlpPolicyRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub patterns: serde_json::Value,
    pub action: String,
    pub enabled: bool,
    pub created_at: i64,
}

pub async fn list_dlp_policies(pool: &PgPool) -> Result<Vec<DlpPolicyRow>, sqlx::Error> {
    sqlx::query_as::<_, DlpPolicyRow>("SELECT id, name, description, patterns, action, enabled, created_at FROM dlp.policies ORDER BY name ASC")
        .fetch_all(pool).await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SraAssessmentRow {
    pub id: String,
    pub name: String,
    pub status: String,
    pub score: Option<f64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_sra_assessments(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<SraAssessmentRow>, sqlx::Error> {
    sqlx::query_as::<_, SraAssessmentRow>("SELECT id, name, status, score, created_at, updated_at FROM security.sra_assessments ORDER BY created_at DESC LIMIT $1")
        .bind(limit).fetch_all(pool).await
}
