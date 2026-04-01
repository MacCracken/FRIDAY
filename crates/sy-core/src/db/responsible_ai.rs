//! Responsible AI storage — policies and audits via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiPolicyRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub rules: serde_json::Value,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiAuditRow {
    pub id: String,
    pub tenant_id: String,
    pub policy_id: Option<String>,
    pub action: String,
    pub result: String,
    pub details: serde_json::Value,
    pub created_at: i64,
}

pub async fn list_policies(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<AiPolicyRow>, sqlx::Error> {
    sqlx::query_as::<_, AiPolicyRow>(
        "SELECT * FROM responsible_ai.policies WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_policy(pool: &PgPool, id: &str) -> Result<Option<AiPolicyRow>, sqlx::Error> {
    sqlx::query_as::<_, AiPolicyRow>("SELECT * FROM responsible_ai.policies WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_policy(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    description: Option<&str>,
    category: &str,
    rules: &serde_json::Value,
) -> Result<AiPolicyRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AiPolicyRow>(
        "INSERT INTO responsible_ai.policies (id, tenant_id, name, description, category, rules, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(description)
    .bind(category)
    .bind(rules)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_audits(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<AiAuditRow>, sqlx::Error> {
    sqlx::query_as::<_, AiAuditRow>(
        "SELECT * FROM responsible_ai.audits WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn create_audit(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    policy_id: Option<&str>,
    action: &str,
    result: &str,
    details: &serde_json::Value,
) -> Result<AiAuditRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, AiAuditRow>(
        "INSERT INTO responsible_ai.audits (id, tenant_id, policy_id, action, result, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(policy_id)
    .bind(action)
    .bind(result)
    .bind(details)
    .bind(now)
    .fetch_one(pool)
    .await
}

// ---------------------------------------------------------------------------
// Cohort analysis
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CohortAnalysisRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub config: serde_json::Value,
    pub result: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_cohort_analysis(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    config: &serde_json::Value,
) -> Result<CohortAnalysisRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, CohortAnalysisRow>(
        "INSERT INTO responsible_ai.cohort_analyses \
         (id, tenant_id, name, config, result, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, '{}', $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_cohort_analyses(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<CohortAnalysisRow>, sqlx::Error> {
    sqlx::query_as::<_, CohortAnalysisRow>(
        "SELECT * FROM responsible_ai.cohort_analyses WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_cohort_analysis(
    pool: &PgPool,
    id: &str,
) -> Result<Option<CohortAnalysisRow>, sqlx::Error> {
    sqlx::query_as::<_, CohortAnalysisRow>(
        "SELECT * FROM responsible_ai.cohort_analyses WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

// ---------------------------------------------------------------------------
// Fairness reports
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FairnessReportRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub config: serde_json::Value,
    pub result: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_fairness_report(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    config: &serde_json::Value,
) -> Result<FairnessReportRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, FairnessReportRow>(
        "INSERT INTO responsible_ai.fairness_reports \
         (id, tenant_id, name, config, result, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, '{}', $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_fairness_reports(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<FairnessReportRow>, sqlx::Error> {
    sqlx::query_as::<_, FairnessReportRow>(
        "SELECT * FROM responsible_ai.fairness_reports WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_fairness_report(
    pool: &PgPool,
    id: &str,
) -> Result<Option<FairnessReportRow>, sqlx::Error> {
    sqlx::query_as::<_, FairnessReportRow>(
        "SELECT * FROM responsible_ai.fairness_reports WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

// ---------------------------------------------------------------------------
// SHAP explainability
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ShapExplanationRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub config: serde_json::Value,
    pub result: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_shap_explanation(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    config: &serde_json::Value,
) -> Result<ShapExplanationRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ShapExplanationRow>(
        "INSERT INTO responsible_ai.shap_explanations \
         (id, tenant_id, name, config, result, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, '{}', $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_shap_explanations(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ShapExplanationRow>, sqlx::Error> {
    sqlx::query_as::<_, ShapExplanationRow>(
        "SELECT * FROM responsible_ai.shap_explanations WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_shap_explanation(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ShapExplanationRow>, sqlx::Error> {
    sqlx::query_as::<_, ShapExplanationRow>(
        "SELECT * FROM responsible_ai.shap_explanations WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

// ---------------------------------------------------------------------------
// Data provenance
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceRow {
    pub id: String,
    pub tenant_id: String,
    pub dataset_id: Option<String>,
    pub user_id: Option<String>,
    pub data: serde_json::Value,
    pub redacted: bool,
    pub created_at: i64,
}

pub async fn list_provenance(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ProvenanceRow>, sqlx::Error> {
    sqlx::query_as::<_, ProvenanceRow>(
        "SELECT * FROM responsible_ai.provenance WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_provenance_summary_by_dataset(
    pool: &PgPool,
    dataset_id: &str,
) -> Result<Vec<ProvenanceRow>, sqlx::Error> {
    sqlx::query_as::<_, ProvenanceRow>(
        "SELECT * FROM responsible_ai.provenance WHERE dataset_id = $1 ORDER BY created_at DESC",
    )
    .bind(dataset_id)
    .fetch_all(pool)
    .await
}

pub async fn get_provenance_by_user(
    pool: &PgPool,
    user_id: &str,
) -> Result<Vec<ProvenanceRow>, sqlx::Error> {
    sqlx::query_as::<_, ProvenanceRow>(
        "SELECT * FROM responsible_ai.provenance WHERE user_id = $1 ORDER BY created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn redact_provenance_by_user(pool: &PgPool, user_id: &str) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("UPDATE responsible_ai.provenance SET redacted = true WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}

// ---------------------------------------------------------------------------
// Model cards
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ModelCardRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub personality_id: Option<String>,
    pub content: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn create_model_card(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    personality_id: Option<&str>,
    content: &serde_json::Value,
) -> Result<ModelCardRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ModelCardRow>(
        "INSERT INTO responsible_ai.model_cards \
         (id, tenant_id, name, personality_id, content, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(personality_id)
    .bind(content)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_model_cards(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ModelCardRow>, sqlx::Error> {
    sqlx::query_as::<_, ModelCardRow>(
        "SELECT * FROM responsible_ai.model_cards WHERE tenant_id = $1 \
         ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_model_card(pool: &PgPool, id: &str) -> Result<Option<ModelCardRow>, sqlx::Error> {
    sqlx::query_as::<_, ModelCardRow>("SELECT * FROM responsible_ai.model_cards WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn get_model_card_by_personality(
    pool: &PgPool,
    personality_id: &str,
) -> Result<Vec<ModelCardRow>, sqlx::Error> {
    sqlx::query_as::<_, ModelCardRow>(
        "SELECT * FROM responsible_ai.model_cards WHERE personality_id = $1 \
         ORDER BY created_at DESC",
    )
    .bind(personality_id)
    .fetch_all(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
