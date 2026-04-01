//! Security storage — DLP, SRA, ATHI, policies, events, scans, access review, SCIM.

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

pub async fn get_dlp_policy(pool: &PgPool, id: &str) -> Result<Option<DlpPolicyRow>, sqlx::Error> {
    sqlx::query_as::<_, DlpPolicyRow>(
        "SELECT id, name, description, patterns, action, enabled, created_at FROM dlp.policies WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn create_dlp_policy(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    patterns: &serde_json::Value,
    action: &str,
    enabled: bool,
) -> Result<DlpPolicyRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, DlpPolicyRow>(
        "INSERT INTO dlp.policies (id, name, description, patterns, action, enabled, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, description, patterns, action, enabled, created_at",
    )
    .bind(id).bind(name).bind(description).bind(patterns).bind(action).bind(enabled).bind(now)
    .fetch_one(pool).await
}

pub async fn update_dlp_policy(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    patterns: &serde_json::Value,
    action: &str,
    enabled: bool,
) -> Result<Option<DlpPolicyRow>, sqlx::Error> {
    sqlx::query_as::<_, DlpPolicyRow>(
        "UPDATE dlp.policies SET name = $2, description = $3, patterns = $4, action = $5, enabled = $6 WHERE id = $1 RETURNING id, name, description, patterns, action, enabled, created_at",
    )
    .bind(id).bind(name).bind(description).bind(patterns).bind(action).bind(enabled)
    .fetch_optional(pool).await
}

pub async fn delete_dlp_policy(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM dlp.policies WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// --- DLP Classifications ---

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DlpClassificationRow {
    pub id: String,
    pub content_id: String,
    pub label: String,
    pub confidence: f64,
    pub overridden: bool,
    pub override_label: Option<String>,
    pub created_at: i64,
}

pub async fn list_dlp_classifications(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<DlpClassificationRow>, sqlx::Error> {
    sqlx::query_as::<_, DlpClassificationRow>(
        "SELECT * FROM dlp.classifications ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit).bind(offset)
    .fetch_all(pool).await
}

pub async fn get_dlp_classification_by_content(
    pool: &PgPool,
    content_id: &str,
) -> Result<Option<DlpClassificationRow>, sqlx::Error> {
    sqlx::query_as::<_, DlpClassificationRow>(
        "SELECT * FROM dlp.classifications WHERE content_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(content_id)
    .fetch_optional(pool).await
}

pub async fn create_dlp_classification(
    pool: &PgPool,
    id: &str,
    content_id: &str,
    label: &str,
    confidence: f64,
) -> Result<DlpClassificationRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, DlpClassificationRow>(
        "INSERT INTO dlp.classifications (id, content_id, label, confidence, overridden, created_at) VALUES ($1, $2, $3, $4, false, $5) RETURNING *",
    )
    .bind(id).bind(content_id).bind(label).bind(confidence).bind(now)
    .fetch_one(pool).await
}

pub async fn override_dlp_classification(
    pool: &PgPool,
    content_id: &str,
    override_label: &str,
) -> Result<Option<DlpClassificationRow>, sqlx::Error> {
    sqlx::query_as::<_, DlpClassificationRow>(
        "UPDATE dlp.classifications SET overridden = true, override_label = $2 WHERE content_id = $1 ORDER BY created_at DESC LIMIT 1 RETURNING *",
    )
    .bind(content_id).bind(override_label)
    .fetch_optional(pool).await
}

// --- DLP Retention ---

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DlpRetentionRow {
    pub id: String,
    pub name: String,
    pub label: String,
    pub retain_days: i64,
    pub enabled: bool,
    pub created_at: i64,
}

pub async fn list_dlp_retention(pool: &PgPool) -> Result<Vec<DlpRetentionRow>, sqlx::Error> {
    sqlx::query_as::<_, DlpRetentionRow>(
        "SELECT * FROM dlp.retention_policies ORDER BY name ASC",
    )
    .fetch_all(pool).await
}

pub async fn create_dlp_retention(
    pool: &PgPool,
    id: &str,
    name: &str,
    label: &str,
    retain_days: i64,
    enabled: bool,
) -> Result<DlpRetentionRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, DlpRetentionRow>(
        "INSERT INTO dlp.retention_policies (id, name, label, retain_days, enabled, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    )
    .bind(id).bind(name).bind(label).bind(retain_days).bind(enabled).bind(now)
    .fetch_one(pool).await
}

pub async fn update_dlp_retention(
    pool: &PgPool,
    id: &str,
    name: &str,
    label: &str,
    retain_days: i64,
    enabled: bool,
) -> Result<Option<DlpRetentionRow>, sqlx::Error> {
    sqlx::query_as::<_, DlpRetentionRow>(
        "UPDATE dlp.retention_policies SET name = $2, label = $3, retain_days = $4, enabled = $5 WHERE id = $1 RETURNING *",
    )
    .bind(id).bind(name).bind(label).bind(retain_days).bind(enabled)
    .fetch_optional(pool).await
}

pub async fn delete_dlp_retention(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM dlp.retention_policies WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// --- SRA ---

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

pub async fn get_sra_assessment(
    pool: &PgPool,
    id: &str,
) -> Result<Option<SraAssessmentRow>, sqlx::Error> {
    sqlx::query_as::<_, SraAssessmentRow>(
        "SELECT id, name, status, score, created_at, updated_at FROM security.sra_assessments WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool).await
}

pub async fn create_sra_assessment(
    pool: &PgPool,
    id: &str,
    name: &str,
    blueprint_id: Option<&str>,
) -> Result<SraAssessmentRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, SraAssessmentRow>(
        "INSERT INTO security.sra_assessments (id, name, status, blueprint_id, created_at, updated_at) VALUES ($1, $2, 'draft', $3, $4, $4) RETURNING id, name, status, score, created_at, updated_at",
    )
    .bind(id).bind(name).bind(blueprint_id).bind(now)
    .fetch_one(pool).await
}

pub async fn update_sra_assessment(
    pool: &PgPool,
    id: &str,
    status: &str,
    score: Option<f64>,
) -> Result<Option<SraAssessmentRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, SraAssessmentRow>(
        "UPDATE security.sra_assessments SET status = $2, score = $3, updated_at = $4 WHERE id = $1 RETURNING id, name, status, score, created_at, updated_at",
    )
    .bind(id).bind(status).bind(score).bind(now)
    .fetch_optional(pool).await
}

// --- SRA Blueprints ---

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SraBlueprintRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub controls: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_sra_blueprints(pool: &PgPool) -> Result<Vec<SraBlueprintRow>, sqlx::Error> {
    sqlx::query_as::<_, SraBlueprintRow>(
        "SELECT * FROM security.sra_blueprints ORDER BY name ASC",
    )
    .fetch_all(pool).await
}

pub async fn get_sra_blueprint(
    pool: &PgPool,
    id: &str,
) -> Result<Option<SraBlueprintRow>, sqlx::Error> {
    sqlx::query_as::<_, SraBlueprintRow>(
        "SELECT * FROM security.sra_blueprints WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool).await
}

pub async fn create_sra_blueprint(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    controls: &serde_json::Value,
) -> Result<SraBlueprintRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, SraBlueprintRow>(
        "INSERT INTO security.sra_blueprints (id, name, description, controls, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *",
    )
    .bind(id).bind(name).bind(description).bind(controls).bind(now)
    .fetch_one(pool).await
}

pub async fn update_sra_blueprint(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    controls: &serde_json::Value,
) -> Result<Option<SraBlueprintRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, SraBlueprintRow>(
        "UPDATE security.sra_blueprints SET name = $2, description = $3, controls = $4, updated_at = $5 WHERE id = $1 RETURNING *",
    )
    .bind(id).bind(name).bind(description).bind(controls).bind(now)
    .fetch_optional(pool).await
}

pub async fn delete_sra_blueprint(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM security.sra_blueprints WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
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
    pub technique: Option<String>,
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

pub async fn get_athi_scenario(
    pool: &PgPool,
    id: &str,
) -> Result<Option<AthiScenarioRow>, sqlx::Error> {
    sqlx::query_as::<_, AthiScenarioRow>(
        "SELECT * FROM security.athi_scenarios WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool).await
}

pub async fn create_athi_scenario(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    description: Option<&str>,
    category: &str,
    technique: Option<&str>,
) -> Result<AthiScenarioRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AthiScenarioRow>(
        "INSERT INTO security.athi_scenarios (id, tenant_id, name, description, category, technique, status, score, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0.0, $7, $7) RETURNING *",
    )
    .bind(id).bind(tenant_id).bind(name).bind(description).bind(category).bind(technique).bind(now)
    .fetch_one(pool).await
}

pub async fn update_athi_scenario(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    category: &str,
    technique: Option<&str>,
) -> Result<Option<AthiScenarioRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AthiScenarioRow>(
        "UPDATE security.athi_scenarios SET name = $2, description = $3, category = $4, technique = $5, updated_at = $6 WHERE id = $1 RETURNING *",
    )
    .bind(id).bind(name).bind(description).bind(category).bind(technique).bind(now)
    .fetch_optional(pool).await
}

pub async fn delete_athi_scenario(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM security.athi_scenarios WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

pub async fn list_athi_scenarios_by_technique(
    pool: &PgPool,
    tenant_id: &str,
    technique: &str,
) -> Result<Vec<AthiScenarioRow>, sqlx::Error> {
    sqlx::query_as::<_, AthiScenarioRow>(
        "SELECT * FROM security.athi_scenarios WHERE tenant_id = $1 AND technique = $2 ORDER BY name ASC",
    )
    .bind(tenant_id).bind(technique)
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

pub async fn get_access_review_campaign(
    pool: &PgPool,
    id: &str,
) -> Result<Option<AccessReviewCampaignRow>, sqlx::Error> {
    sqlx::query_as::<_, AccessReviewCampaignRow>(
        "SELECT * FROM security.access_review_campaigns WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool).await
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

pub async fn close_access_review_campaign(
    pool: &PgPool,
    id: &str,
) -> Result<Option<AccessReviewCampaignRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AccessReviewCampaignRow>(
        "UPDATE security.access_review_campaigns SET status = 'closed', due_at = COALESCE(due_at, $2) WHERE id = $1 RETURNING *",
    )
    .bind(id).bind(now)
    .fetch_optional(pool).await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AccessReviewDecisionRow {
    pub id: String,
    pub campaign_id: String,
    pub entitlement_id: String,
    pub decision: String,
    pub reason: Option<String>,
    pub reviewer: String,
    pub created_at: i64,
}

pub async fn create_access_review_decision(
    pool: &PgPool,
    id: &str,
    campaign_id: &str,
    entitlement_id: &str,
    decision: &str,
    reason: Option<&str>,
    reviewer: &str,
) -> Result<AccessReviewDecisionRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AccessReviewDecisionRow>(
        "INSERT INTO security.access_review_decisions (id, campaign_id, entitlement_id, decision, reason, reviewer, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    )
    .bind(id).bind(campaign_id).bind(entitlement_id).bind(decision).bind(reason).bind(reviewer).bind(now)
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

// --- SCIM Users ---

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScimUserRow {
    pub id: String,
    pub external_id: Option<String>,
    pub user_name: String,
    pub display_name: Option<String>,
    pub active: bool,
    pub emails_json: serde_json::Value,
    pub meta_json: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_scim_users(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ScimUserRow>, sqlx::Error> {
    sqlx::query_as::<_, ScimUserRow>(
        "SELECT * FROM scim.users ORDER BY user_name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit).bind(offset)
    .fetch_all(pool).await
}

pub async fn count_scim_users(pool: &PgPool) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as("SELECT count(*) FROM scim.users")
        .fetch_one(pool).await?;
    Ok(row.0)
}

pub async fn get_scim_user(pool: &PgPool, id: &str) -> Result<Option<ScimUserRow>, sqlx::Error> {
    sqlx::query_as::<_, ScimUserRow>("SELECT * FROM scim.users WHERE id = $1")
        .bind(id)
        .fetch_optional(pool).await
}

pub async fn create_scim_user(
    pool: &PgPool,
    id: &str,
    external_id: Option<&str>,
    user_name: &str,
    display_name: Option<&str>,
    active: bool,
    emails_json: &serde_json::Value,
) -> Result<ScimUserRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ScimUserRow>(
        "INSERT INTO scim.users (id, external_id, user_name, display_name, active, emails_json, meta_json, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7, $7) RETURNING *",
    )
    .bind(id).bind(external_id).bind(user_name).bind(display_name).bind(active).bind(emails_json).bind(now)
    .fetch_one(pool).await
}

pub async fn replace_scim_user(
    pool: &PgPool,
    id: &str,
    external_id: Option<&str>,
    user_name: &str,
    display_name: Option<&str>,
    active: bool,
    emails_json: &serde_json::Value,
) -> Result<Option<ScimUserRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ScimUserRow>(
        "UPDATE scim.users SET external_id = $2, user_name = $3, display_name = $4, active = $5, emails_json = $6, updated_at = $7 WHERE id = $1 RETURNING *",
    )
    .bind(id).bind(external_id).bind(user_name).bind(display_name).bind(active).bind(emails_json).bind(now)
    .fetch_optional(pool).await
}

pub async fn delete_scim_user(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM scim.users WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

// --- SCIM Groups ---

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScimGroupRow {
    pub id: String,
    pub external_id: Option<String>,
    pub display_name: String,
    pub members_json: serde_json::Value,
    pub meta_json: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_scim_groups(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ScimGroupRow>, sqlx::Error> {
    sqlx::query_as::<_, ScimGroupRow>(
        "SELECT * FROM scim.groups ORDER BY display_name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit).bind(offset)
    .fetch_all(pool).await
}

pub async fn count_scim_groups(pool: &PgPool) -> Result<i64, sqlx::Error> {
    let row: (i64,) = sqlx::query_as("SELECT count(*) FROM scim.groups")
        .fetch_one(pool).await?;
    Ok(row.0)
}

pub async fn get_scim_group(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ScimGroupRow>, sqlx::Error> {
    sqlx::query_as::<_, ScimGroupRow>("SELECT * FROM scim.groups WHERE id = $1")
        .bind(id)
        .fetch_optional(pool).await
}

pub async fn create_scim_group(
    pool: &PgPool,
    id: &str,
    external_id: Option<&str>,
    display_name: &str,
    members_json: &serde_json::Value,
) -> Result<ScimGroupRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ScimGroupRow>(
        "INSERT INTO scim.groups (id, external_id, display_name, members_json, meta_json, created_at, updated_at) VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, $5) RETURNING *",
    )
    .bind(id).bind(external_id).bind(display_name).bind(members_json).bind(now)
    .fetch_one(pool).await
}

pub async fn replace_scim_group(
    pool: &PgPool,
    id: &str,
    external_id: Option<&str>,
    display_name: &str,
    members_json: &serde_json::Value,
) -> Result<Option<ScimGroupRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ScimGroupRow>(
        "UPDATE scim.groups SET external_id = $2, display_name = $3, members_json = $4, updated_at = $5 WHERE id = $1 RETURNING *",
    )
    .bind(id).bind(external_id).bind(display_name).bind(members_json).bind(now)
    .fetch_optional(pool).await
}

pub async fn delete_scim_group(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let r = sqlx::query("DELETE FROM scim.groups WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
