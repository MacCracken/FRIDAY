//! Security storage — DLP, SRA, ATHI, policies, events, scans, access review.

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

// --- Security events ---

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecurityEventRow {
    pub id: String,
    pub tenant_id: String,
    pub event_type: String,
    pub severity: String,
    pub source: String,
    pub description: Option<String>,
    pub metadata_json: serde_json::Value,
    pub created_at: i64,
}

pub async fn list_security_events(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<SecurityEventRow>, sqlx::Error> {
    sqlx::query_as::<_, SecurityEventRow>(
        "SELECT * FROM security.events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id).bind(limit).bind(offset)
    .fetch_all(pool).await
}

pub async fn get_security_event(
    pool: &PgPool,
    id: &str,
) -> Result<Option<SecurityEventRow>, sqlx::Error> {
    sqlx::query_as::<_, SecurityEventRow>("SELECT * FROM security.events WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

// --- Security policy ---

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPolicyRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub policy_json: serde_json::Value,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn get_security_policy(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Option<SecurityPolicyRow>, sqlx::Error> {
    sqlx::query_as::<_, SecurityPolicyRow>(
        "SELECT * FROM security.policies WHERE tenant_id = $1 LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_security_policy(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    policy_json: &serde_json::Value,
    enabled: bool,
) -> Result<SecurityPolicyRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, SecurityPolicyRow>(
        "INSERT INTO security.policies (id, tenant_id, name, policy_json, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (tenant_id) DO UPDATE SET name = $3, policy_json = $4, enabled = $5, updated_at = $6
         RETURNING *",
    )
    .bind(id).bind(tenant_id).bind(name).bind(policy_json).bind(enabled).bind(now)
    .fetch_one(pool).await
}

// --- Security scans ---

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecurityScanRow {
    pub id: String,
    pub tenant_id: String,
    pub scan_type: String,
    pub status: String,
    pub findings_json: serde_json::Value,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

pub async fn list_security_scans(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<SecurityScanRow>, sqlx::Error> {
    sqlx::query_as::<_, SecurityScanRow>(
        "SELECT * FROM security.scans WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id).bind(limit).bind(offset)
    .fetch_all(pool).await
}

pub async fn get_security_scan(
    pool: &PgPool,
    id: &str,
) -> Result<Option<SecurityScanRow>, sqlx::Error> {
    sqlx::query_as::<_, SecurityScanRow>("SELECT * FROM security.scans WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_security_scan(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    scan_type: &str,
) -> Result<SecurityScanRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, SecurityScanRow>(
        "INSERT INTO security.scans (id, tenant_id, scan_type, status, findings_json, created_at) VALUES ($1, $2, $3, 'pending', '[]'::jsonb, $4) RETURNING *",
    )
    .bind(id).bind(tenant_id).bind(scan_type).bind(now)
    .fetch_one(pool).await
}

// --- ATHI ---

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AthiSummaryRow {
    pub total_scenarios: i64,
    pub passing: i64,
    pub failing: i64,
    pub score: f64,
}

pub async fn get_athi_summary(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Option<AthiSummaryRow>, sqlx::Error> {
    sqlx::query_as::<_, AthiSummaryRow>(
        "SELECT count(*) as total_scenarios, count(*) FILTER (WHERE status = 'passing') as passing, count(*) FILTER (WHERE status = 'failing') as failing, COALESCE(avg(score), 0.0) as score FROM security.athi_scenarios WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AthiScenarioRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub status: String,
    pub score: f64,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_athi_scenarios(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<AthiScenarioRow>, sqlx::Error> {
    sqlx::query_as::<_, AthiScenarioRow>(
        "SELECT * FROM security.athi_scenarios WHERE tenant_id = $1 ORDER BY category ASC, name ASC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id).bind(limit).bind(offset)
    .fetch_all(pool).await
}

// --- Access review campaigns ---

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AccessReviewCampaignRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub scope: String,
    pub reviewer: String,
    pub created_at: i64,
    pub due_at: Option<i64>,
}

pub async fn list_access_review_campaigns(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<AccessReviewCampaignRow>, sqlx::Error> {
    sqlx::query_as::<_, AccessReviewCampaignRow>(
        "SELECT * FROM security.access_review_campaigns WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id).bind(limit).bind(offset)
    .fetch_all(pool).await
}

pub async fn create_access_review_campaign(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    scope: &str,
    reviewer: &str,
    due_at: Option<i64>,
) -> Result<AccessReviewCampaignRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AccessReviewCampaignRow>(
        "INSERT INTO security.access_review_campaigns (id, tenant_id, name, status, scope, reviewer, created_at, due_at) VALUES ($1, $2, $3, 'open', $4, $5, $6, $7) RETURNING *",
    )
    .bind(id).bind(tenant_id).bind(name).bind(scope).bind(reviewer).bind(now).bind(due_at)
    .fetch_one(pool).await
}

// --- TLS status ---

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TlsStatusRow {
    pub tenant_id: String,
    pub enabled: bool,
    pub certificate_expiry: Option<i64>,
    pub protocol_version: String,
    pub cipher_suite: Option<String>,
    pub updated_at: i64,
}

pub async fn get_tls_status(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Option<TlsStatusRow>, sqlx::Error> {
    sqlx::query_as::<_, TlsStatusRow>(
        "SELECT * FROM security.tls_status WHERE tenant_id = $1 LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
