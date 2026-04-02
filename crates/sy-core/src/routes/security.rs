//! Security routes — DLP, SRA, events, scans, ATHI, access review, TLS,
//! constitutional AI, TEE, guardrail pipeline, WebAuthn, break-glass, rotation.

use crate::db::security;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new()
        // ── DLP policies ──
        .route("/api/v1/security/dlp/policies", get(list_dlp_policies))
        .route("/api/v1/security/dlp/policies", post(create_dlp_policy))
        .route("/api/v1/security/dlp/policies/{id}", get(get_dlp_policy))
        .route("/api/v1/security/dlp/policies/{id}", put(update_dlp_policy))
        .route(
            "/api/v1/security/dlp/policies/{id}",
            delete(delete_dlp_policy),
        )
        // ── DLP classify / scan ──
        .route("/api/v1/security/dlp/classify", post(classify_text))
        .route(
            "/api/v1/security/dlp/classifications",
            get(list_dlp_classifications),
        )
        .route(
            "/api/v1/security/dlp/classifications/{contentId}",
            get(get_dlp_classification),
        )
        .route(
            "/api/v1/security/dlp/classifications/{contentId}",
            put(override_dlp_classification),
        )
        .route("/api/v1/security/dlp/scan", post(scan_outbound))
        // ── DLP egress ──
        .route("/api/v1/security/dlp/egress/stats", get(get_egress_stats))
        .route(
            "/api/v1/security/dlp/egress/anomalies",
            get(get_egress_anomalies),
        )
        .route(
            "/api/v1/security/dlp/egress/destinations",
            get(get_egress_destinations),
        )
        // ── DLP watermark ──
        .route(
            "/api/v1/security/dlp/watermark/embed",
            post(watermark_embed),
        )
        .route(
            "/api/v1/security/dlp/watermark/extract",
            post(watermark_extract),
        )
        .route(
            "/api/v1/security/dlp/watermark/detect",
            post(watermark_detect),
        )
        // ── DLP retention ──
        .route("/api/v1/security/dlp/retention", get(list_dlp_retention))
        .route("/api/v1/security/dlp/retention", post(create_dlp_retention))
        .route(
            "/api/v1/security/dlp/retention/{id}",
            put(update_dlp_retention),
        )
        .route(
            "/api/v1/security/dlp/retention/{id}",
            delete(delete_dlp_retention),
        )
        .route(
            "/api/v1/security/dlp/retention/preview",
            post(preview_retention),
        )
        // ── SRA assessments ──
        .route(
            "/api/v1/security/sra/assessments",
            get(list_sra_assessments),
        )
        .route(
            "/api/v1/security/sra/assessments",
            post(create_sra_assessment),
        )
        .route(
            "/api/v1/security/sra/assessments/{id}",
            get(get_sra_assessment),
        )
        .route(
            "/api/v1/security/sra/assessments/{id}",
            put(update_sra_assessment),
        )
        .route(
            "/api/v1/security/sra/assessments/{id}/generate",
            post(generate_sra_summary),
        )
        // ── SRA blueprints ──
        .route("/api/v1/security/sra/blueprints", get(list_sra_blueprints))
        .route(
            "/api/v1/security/sra/blueprints",
            post(create_sra_blueprint),
        )
        .route(
            "/api/v1/security/sra/blueprints/{id}",
            get(get_sra_blueprint),
        )
        .route(
            "/api/v1/security/sra/blueprints/{id}",
            put(update_sra_blueprint),
        )
        .route(
            "/api/v1/security/sra/blueprints/{id}",
            delete(delete_sra_blueprint),
        )
        // ── SRA misc ──
        .route(
            "/api/v1/security/sra/compliance-mappings",
            get(get_compliance_mappings),
        )
        .route("/api/v1/security/sra/summary", get(get_sra_summary))
        // ── Security events ──
        .route("/api/v1/security/events", get(list_security_events))
        .route("/api/v1/security/events/{id}", get(get_security_event))
        // ── Security policy ──
        .route("/api/v1/security/policy", get(get_security_policy))
        .route("/api/v1/security/policy", put(update_security_policy))
        // ── Security scans ──
        .route("/api/v1/security/scans", get(list_security_scans))
        .route("/api/v1/security/scans", post(trigger_security_scan))
        .route("/api/v1/security/scans/{id}", get(get_security_scan))
        // ── ATHI ──
        .route("/api/v1/security/athi/summary", get(get_athi_summary))
        .route("/api/v1/security/athi/scenarios", get(list_athi_scenarios))
        .route(
            "/api/v1/security/athi/scenarios",
            post(create_athi_scenario),
        )
        .route(
            "/api/v1/security/athi/scenarios/{id}",
            get(get_athi_scenario),
        )
        .route(
            "/api/v1/security/athi/scenarios/{id}",
            put(update_athi_scenario),
        )
        .route(
            "/api/v1/security/athi/scenarios/{id}",
            delete(delete_athi_scenario),
        )
        .route(
            "/api/v1/security/athi/scenarios/{id}/link-events",
            post(link_athi_events),
        )
        .route(
            "/api/v1/security/athi/scenarios/by-technique/{technique}",
            get(list_athi_by_technique),
        )
        .route("/api/v1/security/athi/matrix", get(get_athi_matrix))
        .route("/api/v1/security/athi/top-risks", get(get_athi_top_risks))
        // ── Constitutional AI ──
        .route(
            "/api/v1/security/constitutional/principles",
            get(list_principles),
        )
        .route(
            "/api/v1/security/constitutional/critique",
            post(critique_response),
        )
        .route(
            "/api/v1/security/constitutional/revise",
            post(revise_response),
        )
        // ── TEE ──
        .route("/api/v1/security/tee/providers", get(list_tee_providers))
        .route(
            "/api/v1/security/tee/attestation/{provider}",
            get(get_attestation_history),
        )
        .route(
            "/api/v1/security/tee/verify/{provider}",
            post(verify_attestation),
        )
        // ── Guardrail pipeline ──
        .route(
            "/api/v1/security/guardrail-pipeline/filters",
            get(list_guardrail_filters),
        )
        .route(
            "/api/v1/security/guardrail-pipeline/filters/{filterId}/toggle",
            put(toggle_guardrail_filter),
        )
        .route(
            "/api/v1/security/guardrail-pipeline/metrics",
            get(get_guardrail_metrics),
        )
        .route(
            "/api/v1/security/guardrail-pipeline/metrics/reset",
            post(reset_guardrail_metrics),
        )
        .route(
            "/api/v1/security/guardrail-pipeline/test",
            post(test_guardrail_pipeline),
        )
        // ── Access review ──
        .route(
            "/api/v1/security/access-review/campaigns",
            get(list_access_review_campaigns),
        )
        .route(
            "/api/v1/security/access-review/campaigns",
            post(create_access_review_campaign),
        )
        .route(
            "/api/v1/security/access-review/campaigns/{id}",
            get(get_access_review_campaign),
        )
        .route(
            "/api/v1/security/access-review/campaigns/{id}/decisions",
            post(submit_access_review_decision),
        )
        .route(
            "/api/v1/security/access-review/campaigns/{id}/close",
            post(close_access_review_campaign),
        )
        .route(
            "/api/v1/security/access-review/entitlements",
            get(get_entitlement_report),
        )
        // ── TLS ──
        .route("/api/v1/security/tls", get(get_tls_status))
        // NOTE: WebAuthn and break-glass routes live in auth.rs (they're /api/v1/auth/* paths)
        // ── Key rotation ──
        .route("/api/v1/admin/key-rotation", get(get_rotation_status))
        .route(
            "/api/v1/admin/key-rotation/{name}/rotate",
            post(rotate_secret),
        )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn err_unavailable() -> axum::response::Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    )
        .into_response()
}

fn err_internal(e: impl std::fmt::Display) -> axum::response::Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"error": e.to_string()})),
    )
        .into_response()
}

fn not_found(msg: &'static str) -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"error": msg})),
    )
        .into_response()
}

// ── Pagination ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct PQ {
    #[serde(default = "dl")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}
fn dl() -> i64 {
    20
}

#[derive(Deserialize)]
struct LimitQuery {
    #[serde(default = "dl")]
    limit: i64,
}

// ── DLP policies ──────────────────────────────────────────────────────────────

async fn list_dlp_policies(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_dlp_policies(pool).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDlpPolicyRequest {
    name: String,
    description: Option<String>,
    #[serde(default = "empty_json_array")]
    patterns: serde_json::Value,
    #[serde(default = "default_action")]
    action: String,
    #[serde(default = "default_true")]
    enabled: bool,
}
fn empty_json_array() -> serde_json::Value {
    serde_json::json!([])
}
fn default_action() -> String {
    "block".to_string()
}
fn default_true() -> bool {
    true
}

async fn create_dlp_policy(
    State(s): State<AppState>,
    Json(body): Json<CreateDlpPolicyRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::create_dlp_policy(
        pool,
        &id,
        &body.name,
        body.description.as_deref(),
        &body.patterns,
        &body.action,
        body.enabled,
    )
    .await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn get_dlp_policy(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_dlp_policy(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("DLP policy not found"),
        Err(e) => err_internal(e),
    }
}

async fn update_dlp_policy(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<CreateDlpPolicyRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::update_dlp_policy(
        pool,
        &id,
        &body.name,
        body.description.as_deref(),
        &body.patterns,
        &body.action,
        body.enabled,
    )
    .await
    {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("DLP policy not found"),
        Err(e) => err_internal(e),
    }
}

async fn delete_dlp_policy(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::delete_dlp_policy(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("DLP policy not found"),
        Err(e) => err_internal(e),
    }
}

// ── DLP classify / scan ───────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClassifyTextRequest {
    text: String,
    content_id: Option<String>,
}

async fn classify_text(
    State(s): State<AppState>,
    Json(body): Json<ClassifyTextRequest>,
) -> impl IntoResponse {
    // Placeholder classifier: label based on length heuristic.
    let label = if body.text.len() > 500 {
        "sensitive"
    } else {
        "public"
    };
    let confidence: f64 = 0.85;
    let content_id = body
        .content_id
        .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());

    if let Some(pool) = s.db() {
        let id = uuid::Uuid::now_v7().to_string();
        let _ =
            security::create_dlp_classification(pool, &id, &content_id, label, confidence).await;
    }

    Json(serde_json::json!({
        "contentId": content_id,
        "label": label,
        "confidence": confidence,
        "engine": "placeholder-v1",
    }))
    .into_response()
}

async fn list_dlp_classifications(
    State(s): State<AppState>,
    Query(q): Query<PQ>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_dlp_classifications(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn get_dlp_classification(
    State(s): State<AppState>,
    Path(content_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_dlp_classification_by_content(pool, &content_id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Classification not found"),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverrideClassificationRequest {
    label: String,
}

async fn override_dlp_classification(
    State(s): State<AppState>,
    Path(content_id): Path<String>,
    Json(body): Json<OverrideClassificationRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::override_dlp_classification(pool, &content_id, &body.label).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Classification not found"),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanOutboundRequest {
    content: String,
    destination: Option<String>,
}

async fn scan_outbound(Json(body): Json<ScanOutboundRequest>) -> impl IntoResponse {
    // Placeholder: always allow, flag if content is very long.
    let blocked = body.content.len() > 10_000;
    Json(serde_json::json!({
        "allowed": !blocked,
        "blocked": blocked,
        "destination": body.destination,
        "matchedPolicies": [],
        "engine": "placeholder-v1",
    }))
    .into_response()
}

// ── DLP egress (placeholder) ──────────────────────────────────────────────────

async fn get_egress_stats() -> impl IntoResponse {
    Json(serde_json::json!({
        "totalBytes": 0,
        "blockedBytes": 0,
        "allowedBytes": 0,
        "topDestinations": [],
    }))
    .into_response()
}

async fn get_egress_anomalies() -> impl IntoResponse {
    Json(serde_json::json!({ "anomalies": [] })).into_response()
}

async fn get_egress_destinations() -> impl IntoResponse {
    Json(serde_json::json!({ "destinations": [] })).into_response()
}

// ── DLP watermark (placeholder) ───────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatermarkEmbedRequest {
    content: String,
    mark: String,
}

async fn watermark_embed(Json(body): Json<WatermarkEmbedRequest>) -> impl IntoResponse {
    // Placeholder: append mark as comment.
    let watermarked = format!("{} <!--wm:{}-->", body.content, body.mark);
    Json(serde_json::json!({ "watermarked": watermarked, "mark": body.mark })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatermarkContentRequest {
    content: String,
}

async fn watermark_extract(Json(body): Json<WatermarkContentRequest>) -> impl IntoResponse {
    let mark = if let Some(start) = body.content.find("<!--wm:") {
        let rest = &body.content[start + 7..];
        rest.find("-->").map(|end| rest[..end].to_string())
    } else {
        None
    };
    Json(serde_json::json!({ "mark": mark, "found": mark.is_some() })).into_response()
}

async fn watermark_detect(Json(body): Json<WatermarkContentRequest>) -> impl IntoResponse {
    let detected = body.content.contains("<!--wm:");
    Json(serde_json::json!({ "detected": detected })).into_response()
}

// ── DLP retention ─────────────────────────────────────────────────────────────

async fn list_dlp_retention(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_dlp_retention(pool).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRetentionRequest {
    name: String,
    label: String,
    retain_days: i64,
    #[serde(default = "default_true")]
    enabled: bool,
}

async fn create_dlp_retention(
    State(s): State<AppState>,
    Json(body): Json<CreateRetentionRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::create_dlp_retention(
        pool,
        &id,
        &body.name,
        &body.label,
        body.retain_days,
        body.enabled,
    )
    .await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn update_dlp_retention(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<CreateRetentionRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::update_dlp_retention(
        pool,
        &id,
        &body.name,
        &body.label,
        body.retain_days,
        body.enabled,
    )
    .await
    {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Retention policy not found"),
        Err(e) => err_internal(e),
    }
}

async fn delete_dlp_retention(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::delete_dlp_retention(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Retention policy not found"),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewRetentionRequest {
    label: String,
    retain_days: i64,
}

async fn preview_retention(Json(body): Json<PreviewRetentionRequest>) -> impl IntoResponse {
    // Placeholder preview — returns what would be affected.
    Json(serde_json::json!({
        "label": body.label,
        "retainDays": body.retain_days,
        "estimatedRecordsAffected": 0,
        "preview": true,
    }))
    .into_response()
}

// ── SRA assessments ───────────────────────────────────────────────────────────

async fn list_sra_assessments(
    State(s): State<AppState>,
    Query(q): Query<LimitQuery>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_sra_assessments(pool, q.limit.min(100)).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSraAssessmentRequest {
    name: String,
    blueprint_id: Option<String>,
}

async fn create_sra_assessment(
    State(s): State<AppState>,
    Json(body): Json<CreateSraAssessmentRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::create_sra_assessment(pool, &id, &body.name, body.blueprint_id.as_deref()).await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn get_sra_assessment(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_sra_assessment(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("SRA assessment not found"),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSraAssessmentRequest {
    status: String,
    score: Option<f64>,
}

async fn update_sra_assessment(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateSraAssessmentRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::update_sra_assessment(pool, &id, &body.status, body.score).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("SRA assessment not found"),
        Err(e) => err_internal(e),
    }
}

async fn generate_sra_summary(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_sra_assessment(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::json!({
            "assessmentId": id,
            "name": r.name,
            "status": r.status,
            "score": r.score,
            "summary": "Assessment summary generated by placeholder engine.",
            "recommendations": [],
        }))
        .into_response(),
        Ok(None) => not_found("SRA assessment not found"),
        Err(e) => err_internal(e),
    }
}

// ── SRA blueprints ────────────────────────────────────────────────────────────

async fn list_sra_blueprints(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_sra_blueprints(pool).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSraBlueprintRequest {
    name: String,
    description: Option<String>,
    #[serde(default = "empty_json_array")]
    controls: serde_json::Value,
}

async fn create_sra_blueprint(
    State(s): State<AppState>,
    Json(body): Json<CreateSraBlueprintRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::create_sra_blueprint(
        pool,
        &id,
        &body.name,
        body.description.as_deref(),
        &body.controls,
    )
    .await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn get_sra_blueprint(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_sra_blueprint(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("SRA blueprint not found"),
        Err(e) => err_internal(e),
    }
}

async fn update_sra_blueprint(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<CreateSraBlueprintRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::update_sra_blueprint(
        pool,
        &id,
        &body.name,
        body.description.as_deref(),
        &body.controls,
    )
    .await
    {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("SRA blueprint not found"),
        Err(e) => err_internal(e),
    }
}

async fn delete_sra_blueprint(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::delete_sra_blueprint(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("SRA blueprint not found"),
        Err(e) => err_internal(e),
    }
}

// ── SRA misc (placeholder) ────────────────────────────────────────────────────

async fn get_compliance_mappings() -> impl IntoResponse {
    Json(serde_json::json!({
        "mappings": [
            {"framework": "SOC2", "controls": []},
            {"framework": "ISO27001", "controls": []},
            {"framework": "NIST", "controls": []},
        ]
    }))
    .into_response()
}

async fn get_sra_summary(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_sra_assessments(pool, 1000).await {
        Ok(rows) => {
            let total = rows.len();
            let complete = rows.iter().filter(|r| r.status == "complete").count();
            let avg_score: f64 = if total > 0 {
                rows.iter().filter_map(|r| r.score).sum::<f64>() / total as f64
            } else {
                0.0
            };
            Json(serde_json::json!({
                "totalAssessments": total,
                "complete": complete,
                "averageScore": avg_score,
            }))
            .into_response()
        }
        Err(e) => err_internal(e),
    }
}

// ── Security events ───────────────────────────────────────────────────────────

async fn list_security_events(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_security_events(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => {
            let total = r.len();
            Json(serde_json::json!({"events": r, "total": total})).into_response()
        }
        Err(e) => err_internal(e),
    }
}

async fn get_security_event(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_security_event(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Security event not found"),
        Err(e) => err_internal(e),
    }
}

// ── Security policy ───────────────────────────────────────────────────────────

async fn get_security_policy(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_security_policy(pool, "default").await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("No security policy configured"),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePolicyRequest {
    name: String,
    policy_json: serde_json::Value,
    #[serde(default = "default_true")]
    enabled: bool,
}

async fn update_security_policy(
    State(s): State<AppState>,
    Json(body): Json<UpdatePolicyRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::upsert_security_policy(
        pool,
        &id,
        "default",
        &body.name,
        &body.policy_json,
        body.enabled,
    )
    .await
    {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => err_internal(e),
    }
}

// ── Security scans ────────────────────────────────────────────────────────────

async fn list_security_scans(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_security_scans(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriggerScanRequest {
    #[serde(default = "default_scan_type")]
    scan_type: String,
}
fn default_scan_type() -> String {
    "full".to_string()
}

async fn trigger_security_scan(
    State(s): State<AppState>,
    Json(body): Json<TriggerScanRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::create_security_scan(pool, &id, "default", &body.scan_type).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn get_security_scan(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_security_scan(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Scan not found"),
        Err(e) => err_internal(e),
    }
}

// ── ATHI ─────────────────────────────────────────────────────────────────────

async fn get_athi_summary(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_athi_summary(pool, "default").await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => {
            Json(serde_json::json!({"totalScenarios": 0, "passing": 0, "failing": 0, "score": 0.0}))
                .into_response()
        }
        Err(e) => err_internal(e),
    }
}

async fn list_athi_scenarios(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_athi_scenarios(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAthiScenarioRequest {
    name: String,
    description: Option<String>,
    category: String,
    technique: Option<String>,
}

async fn create_athi_scenario(
    State(s): State<AppState>,
    Json(body): Json<CreateAthiScenarioRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::create_athi_scenario(
        pool,
        &id,
        "default",
        &body.name,
        body.description.as_deref(),
        &body.category,
        body.technique.as_deref(),
    )
    .await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn get_athi_scenario(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_athi_scenario(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("ATHI scenario not found"),
        Err(e) => err_internal(e),
    }
}

async fn update_athi_scenario(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<CreateAthiScenarioRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::update_athi_scenario(
        pool,
        &id,
        &body.name,
        body.description.as_deref(),
        &body.category,
        body.technique.as_deref(),
    )
    .await
    {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("ATHI scenario not found"),
        Err(e) => err_internal(e),
    }
}

async fn delete_athi_scenario(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::delete_athi_scenario(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("ATHI scenario not found"),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkEventsRequest {
    event_ids: Vec<String>,
}

async fn link_athi_events(
    Path(id): Path<String>,
    Json(body): Json<LinkEventsRequest>,
) -> impl IntoResponse {
    // Placeholder: in production this inserts into a junction table.
    Json(serde_json::json!({
        "scenarioId": id,
        "linkedEvents": body.event_ids.len(),
        "eventIds": body.event_ids,
    }))
    .into_response()
}

async fn list_athi_by_technique(
    State(s): State<AppState>,
    Path(technique): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_athi_scenarios_by_technique(pool, "default", &technique).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn get_athi_matrix(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_athi_scenarios(pool, "default", 1000, 0).await {
        Ok(rows) => {
            let mut by_category: std::collections::HashMap<
                String,
                Vec<&security::AthiScenarioRow>,
            > = std::collections::HashMap::new();
            for row in &rows {
                by_category
                    .entry(row.category.clone())
                    .or_default()
                    .push(row);
            }
            let matrix: Vec<_> = by_category
                .iter()
                .map(|(cat, scenarios)| {
                    serde_json::json!({
                        "category": cat,
                        "count": scenarios.len(),
                        "avgScore": scenarios.iter().map(|s| s.score).sum::<f64>() / scenarios.len() as f64,
                    })
                })
                .collect();
            Json(serde_json::json!({ "matrix": matrix })).into_response()
        }
        Err(e) => err_internal(e),
    }
}

async fn get_athi_top_risks(
    State(s): State<AppState>,
    Query(q): Query<LimitQuery>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_athi_scenarios(pool, "default", 1000, 0).await {
        Ok(mut rows) => {
            rows.sort_by(|a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            rows.truncate(q.limit.min(20) as usize);
            Json(serde_json::to_value(rows).unwrap()).into_response()
        }
        Err(e) => err_internal(e),
    }
}

// ── Constitutional AI (placeholder) ──────────────────────────────────────────

async fn list_principles() -> impl IntoResponse {
    Json(serde_json::json!({
        "principles": [
            {"id": "harmlessness", "name": "Harmlessness", "description": "Avoid harmful content."},
            {"id": "honesty", "name": "Honesty", "description": "Do not deceive."},
            {"id": "helpfulness", "name": "Helpfulness", "description": "Be genuinely useful."},
        ]
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CritiqueRequest {
    response: String,
    principles: Vec<String>,
}

async fn critique_response(Json(body): Json<CritiqueRequest>) -> impl IntoResponse {
    Json(serde_json::json!({
        "critique": format!("Evaluated against {} principles. No violations detected (placeholder).", body.principles.len()),
        "violations": [],
        "responseLength": body.response.len(),
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviseRequest {
    response: String,
    principles: Vec<String>,
}

async fn revise_response(Json(body): Json<ReviseRequest>) -> impl IntoResponse {
    Json(serde_json::json!({
        "original": body.response,
        "revised": body.response,
        "principlesApplied": body.principles,
        "changed": false,
    }))
    .into_response()
}

// ── TEE (placeholder) ─────────────────────────────────────────────────────────

async fn list_tee_providers() -> impl IntoResponse {
    Json(serde_json::json!({
        "providers": [
            {"id": "sgx", "name": "Intel SGX", "available": false},
            {"id": "sev", "name": "AMD SEV", "available": false},
            {"id": "trustzone", "name": "ARM TrustZone", "available": false},
        ]
    }))
    .into_response()
}

async fn get_attestation_history(Path(provider): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({
        "provider": provider,
        "attestations": [],
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyAttestationRequest {
    quote: Option<String>,
}

async fn verify_attestation(
    Path(provider): Path<String>,
    Json(_body): Json<VerifyAttestationRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "provider": provider,
        "verified": false,
        "message": "TEE attestation verification not yet implemented.",
    }))
    .into_response()
}

// ── Guardrail pipeline (placeholder) ─────────────────────────────────────────

async fn list_guardrail_filters() -> impl IntoResponse {
    Json(serde_json::json!({
        "filters": [
            {"id": "pii", "name": "PII Detection", "enabled": true},
            {"id": "prompt-injection", "name": "Prompt Injection", "enabled": true},
            {"id": "toxicity", "name": "Toxicity Filter", "enabled": true},
        ]
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToggleFilterRequest {
    enabled: bool,
}

async fn toggle_guardrail_filter(
    Path(filter_id): Path<String>,
    Json(body): Json<ToggleFilterRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "filterId": filter_id,
        "enabled": body.enabled,
        "updated": true,
    }))
    .into_response()
}

async fn get_guardrail_metrics() -> impl IntoResponse {
    Json(serde_json::json!({
        "totalRequests": 0,
        "blocked": 0,
        "passed": 0,
        "filterBreakdown": {},
    }))
    .into_response()
}

async fn reset_guardrail_metrics() -> impl IntoResponse {
    Json(serde_json::json!({ "reset": true })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestPipelineRequest {
    input: String,
}

async fn test_guardrail_pipeline(Json(body): Json<TestPipelineRequest>) -> impl IntoResponse {
    Json(serde_json::json!({
        "input": body.input,
        "passed": true,
        "blocked": false,
        "filterResults": [],
    }))
    .into_response()
}

// ── Access review ─────────────────────────────────────────────────────────────

async fn list_access_review_campaigns(
    State(s): State<AppState>,
    Query(q): Query<PQ>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::list_access_review_campaigns(pool, "default", q.limit.min(100), q.offset).await
    {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCampaignRequest {
    name: String,
    scope: String,
    reviewer: String,
    due_at: Option<i64>,
}

async fn create_access_review_campaign(
    State(s): State<AppState>,
    Json(body): Json<CreateCampaignRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::create_access_review_campaign(
        pool,
        &id,
        "default",
        &body.name,
        &body.scope,
        &body.reviewer,
        body.due_at,
    )
    .await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn get_access_review_campaign(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_access_review_campaign(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Campaign not found"),
        Err(e) => err_internal(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmitDecisionRequest {
    entitlement_id: String,
    decision: String,
    reason: Option<String>,
    reviewer: String,
}

async fn submit_access_review_decision(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<SubmitDecisionRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let decision_id = uuid::Uuid::now_v7().to_string();
    match security::create_access_review_decision(
        pool,
        &decision_id,
        &id,
        &body.entitlement_id,
        &body.decision,
        body.reason.as_deref(),
        &body.reviewer,
    )
    .await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn close_access_review_campaign(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::close_access_review_campaign(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Campaign not found"),
        Err(e) => err_internal(e),
    }
}

async fn get_entitlement_report(State(s): State<AppState>) -> impl IntoResponse {
    let Some(_pool) = s.db() else {
        return err_unavailable();
    };
    // Placeholder entitlement report — real implementation joins IAM tables.
    Json(serde_json::json!({
        "entitlements": [],
        "totalEntitlements": 0,
        "staleEntitlements": 0,
        "overPrivileged": 0,
        "generatedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
    }))
    .into_response()
}

// ── TLS status ────────────────────────────────────────────────────────────────

async fn get_tls_status(State(s): State<AppState>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_tls_status(pool, "default").await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("No TLS status available"),
        Err(e) => err_internal(e),
    }
}

// ── WebAuthn (placeholder) ────────────────────────────────────────────────────

async fn webauthn_register_options() -> impl IntoResponse {
    let challenge = uuid::Uuid::now_v7().to_string();
    Json(serde_json::json!({
        "challenge": challenge,
        "rp": {"name": "SecureYeoman", "id": "secureyeoman.com"},
        "user": {"id": "", "name": "", "displayName": ""},
        "pubKeyCredParams": [{"alg": -7, "type": "public-key"}],
        "timeout": 60000,
        "attestation": "none",
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebAuthnVerifyRequest {
    credential: serde_json::Value,
}

async fn webauthn_register_verify(Json(_body): Json<WebAuthnVerifyRequest>) -> impl IntoResponse {
    let credential_id = uuid::Uuid::now_v7().to_string();
    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "verified": true,
            "credentialId": credential_id,
        })),
    )
        .into_response()
}

async fn webauthn_authenticate_options() -> impl IntoResponse {
    let challenge = uuid::Uuid::now_v7().to_string();
    Json(serde_json::json!({
        "challenge": challenge,
        "timeout": 60000,
        "rpId": "secureyeoman.com",
        "allowCredentials": [],
        "userVerification": "preferred",
    }))
    .into_response()
}

async fn webauthn_authenticate_verify(
    Json(_body): Json<WebAuthnVerifyRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "verified": true,
        "userId": null,
    }))
    .into_response()
}

async fn list_webauthn_credentials() -> impl IntoResponse {
    Json(serde_json::json!({ "credentials": [] })).into_response()
}

async fn delete_webauthn_credential(Path(id): Path<String>) -> impl IntoResponse {
    let _ = id;
    StatusCode::NO_CONTENT.into_response()
}

// ── Break-glass (placeholder) ─────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivateBreakGlassRequest {
    reason: String,
    requestor: String,
}

async fn activate_break_glass(Json(body): Json<ActivateBreakGlassRequest>) -> impl IntoResponse {
    let session_id = uuid::Uuid::now_v7().to_string();
    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "sessionId": session_id,
            "reason": body.reason,
            "requestor": body.requestor,
            "activatedAt": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64,
            "expiresInSeconds": 3600,
        })),
    )
        .into_response()
}

async fn list_break_glass_sessions() -> impl IntoResponse {
    Json(serde_json::json!({ "sessions": [] })).into_response()
}

async fn revoke_break_glass_session(Path(id): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({ "sessionId": id, "revoked": true })).into_response()
}

async fn rotate_recovery_key() -> impl IntoResponse {
    let key_id = uuid::Uuid::now_v7().to_string();
    Json(serde_json::json!({
        "keyId": key_id,
        "rotatedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
        "message": "Recovery key rotated. Store the new key securely.",
    }))
    .into_response()
}

// ── Key rotation (placeholder) ────────────────────────────────────────────────

async fn get_rotation_status() -> impl IntoResponse {
    Json(serde_json::json!({
        "secrets": [
            {"name": "db-password", "lastRotated": null, "nextRotation": null, "status": "manual"},
            {"name": "jwt-secret", "lastRotated": null, "nextRotation": null, "status": "manual"},
            {"name": "api-key", "lastRotated": null, "nextRotation": null, "status": "manual"},
        ]
    }))
    .into_response()
}

async fn rotate_secret(Path(name): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({
        "name": name,
        "rotated": true,
        "rotatedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
        "message": "Secret rotation initiated (placeholder — wire to vault in production).",
    }))
    .into_response()
}
