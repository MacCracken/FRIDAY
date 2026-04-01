//! Responsible AI routes — policy management, audits, evaluation, cohort analysis,
//! fairness, SHAP explainability, data provenance, and model cards.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::responsible_ai;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // Existing
        .route("/api/v1/responsible-ai/policies", get(list_policies))
        .route("/api/v1/responsible-ai/policies", post(create_policy))
        .route("/api/v1/responsible-ai/policies/{id}", get(get_policy))
        .route("/api/v1/responsible-ai/audits", get(list_audits))
        .route("/api/v1/responsible-ai/evaluate", post(evaluate))
        .route("/api/v1/responsible-ai/dashboard", get(dashboard))
        // Cohort analysis
        .route(
            "/api/v1/responsible-ai/cohort-analysis",
            post(create_cohort_analysis),
        )
        .route(
            "/api/v1/responsible-ai/cohort-analysis",
            get(list_cohort_analyses),
        )
        .route(
            "/api/v1/responsible-ai/cohort-analysis/{id}",
            get(get_cohort_analysis),
        )
        // Fairness
        .route(
            "/api/v1/responsible-ai/fairness",
            post(create_fairness_report),
        )
        .route(
            "/api/v1/responsible-ai/fairness",
            get(list_fairness_reports),
        )
        .route(
            "/api/v1/responsible-ai/fairness/{id}",
            get(get_fairness_report),
        )
        // SHAP explainability
        .route("/api/v1/responsible-ai/shap", post(create_shap_explanation))
        .route("/api/v1/responsible-ai/shap", get(list_shap_explanations))
        .route(
            "/api/v1/responsible-ai/shap/{id}",
            get(get_shap_explanation),
        )
        // Data provenance
        .route("/api/v1/responsible-ai/provenance", get(list_provenance))
        .route(
            "/api/v1/responsible-ai/provenance/summary/{datasetId}",
            get(provenance_summary_by_dataset),
        )
        .route(
            "/api/v1/responsible-ai/provenance/user/{userId}",
            get(provenance_by_user),
        )
        .route(
            "/api/v1/responsible-ai/provenance/redact/{userId}",
            post(redact_provenance),
        )
        // Model cards
        .route(
            "/api/v1/responsible-ai/model-cards",
            post(create_model_card),
        )
        .route("/api/v1/responsible-ai/model-cards", get(list_model_cards))
        .route(
            "/api/v1/responsible-ai/model-cards/{id}",
            get(get_model_card),
        )
        .route(
            "/api/v1/responsible-ai/model-cards/{id}/markdown",
            get(get_model_card_markdown),
        )
        .route(
            "/api/v1/responsible-ai/model-cards/by-personality/{personalityId}",
            get(get_model_cards_by_personality),
        )
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

async fn list_policies(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match responsible_ai::list_policies(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePolicyRequest {
    name: String,
    description: Option<String>,
    category: String,
    rules: Option<serde_json::Value>,
}

async fn create_policy(
    State(state): State<AppState>,
    Json(body): Json<CreatePolicyRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    let rules = body.rules.unwrap_or(serde_json::json!({}));
    match responsible_ai::create_policy(
        pool,
        &id,
        "default",
        &body.name,
        body.description.as_deref(),
        &body.category,
        &rules,
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_policy(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match responsible_ai::get_policy(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Policy not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_audits(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match responsible_ai::list_audits(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvaluateRequest {
    policy_id: Option<String>,
    action: String,
    context: Option<serde_json::Value>,
}

async fn evaluate(
    State(state): State<AppState>,
    Json(body): Json<EvaluateRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    let details = body.context.unwrap_or(serde_json::json!({}));
    match responsible_ai::create_audit(
        pool,
        &id,
        "default",
        body.policy_id.as_deref(),
        &body.action,
        "pass",
        &details,
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn dashboard(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    // Return recent audits and policy count as a dashboard summary
    let policies = responsible_ai::list_policies(pool, "default", 100, 0).await;
    let audits = responsible_ai::list_audits(pool, "default", 10, 0).await;
    match (policies, audits) {
        (Ok(p), Ok(a)) => Json(serde_json::json!({
            "totalPolicies": p.len(),
            "recentAudits": serde_json::to_value(a).unwrap(),
        }))
        .into_response(),
        (Err(e), _) | (_, Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ============================================================
// Shared helpers
// ============================================================

fn no_db() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    )
}

fn db_err(e: sqlx::Error) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"error": e.to_string()})),
    )
}

fn not_found(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"error": msg})),
    )
}

fn empty_obj() -> serde_json::Value {
    serde_json::json!({})
}

// ============================================================
// Cohort analysis
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCohortAnalysisRequest {
    name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_cohort_analysis(
    State(state): State<AppState>,
    Json(body): Json<CreateCohortAnalysisRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match responsible_ai::create_cohort_analysis(pool, &id, "default", &body.name, &body.config)
        .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_cohort_analyses(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::list_cohort_analyses(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_cohort_analysis(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::get_cohort_analysis(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Cohort analysis not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Fairness
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateFairnessReportRequest {
    name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_fairness_report(
    State(state): State<AppState>,
    Json(body): Json<CreateFairnessReportRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match responsible_ai::create_fairness_report(pool, &id, "default", &body.name, &body.config)
        .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_fairness_reports(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::list_fairness_reports(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_fairness_report(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::get_fairness_report(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Fairness report not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// SHAP explainability
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateShapExplanationRequest {
    name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_shap_explanation(
    State(state): State<AppState>,
    Json(body): Json<CreateShapExplanationRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match responsible_ai::create_shap_explanation(pool, &id, "default", &body.name, &body.config)
        .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_shap_explanations(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::list_shap_explanations(pool, "default", q.limit.min(100), q.offset).await
    {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_shap_explanation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::get_shap_explanation(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("SHAP explanation not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Data provenance
// ============================================================

async fn list_provenance(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::list_provenance(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn provenance_summary_by_dataset(
    State(state): State<AppState>,
    Path(dataset_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::get_provenance_summary_by_dataset(pool, &dataset_id).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn provenance_by_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::get_provenance_by_user(pool, &user_id).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn redact_provenance(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match responsible_ai::redact_provenance_by_user(pool, &user_id).await {
        Ok(count) => Json(serde_json::json!({"redacted": count})).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Model cards
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateModelCardRequest {
    name: String,
    personality_id: Option<String>,
    #[serde(default = "empty_obj")]
    content: serde_json::Value,
}

async fn create_model_card(
    State(state): State<AppState>,
    Json(body): Json<CreateModelCardRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match responsible_ai::create_model_card(
        pool,
        &id,
        "default",
        &body.name,
        body.personality_id.as_deref(),
        &body.content,
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_model_cards(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::list_model_cards(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_model_card(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::get_model_card(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Model card not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_model_card_markdown(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::get_model_card(pool, &id).await {
        Ok(Some(row)) => {
            // Render content JSON as a simple markdown representation.
            let md = format!(
                "# Model Card: {}\n\n```json\n{}\n```\n",
                row.name,
                serde_json::to_string_pretty(&row.content).unwrap_or_default()
            );
            (
                StatusCode::OK,
                [(axum::http::header::CONTENT_TYPE, "text/markdown")],
                md,
            )
                .into_response()
        }
        Ok(None) => not_found("Model card not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_model_cards_by_personality(
    State(state): State<AppState>,
    Path(personality_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match responsible_ai::get_model_card_by_personality(pool, &personality_id).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}
