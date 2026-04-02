//! Spirit routes — config, passions, inspirations, pains, prompt preview, stats.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::spirit;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/spirit/config", get(spirit_config))
        .route("/api/v1/spirit/passions", get(list_passions))
        .route("/api/v1/spirit/passions/{id}", get(get_passion))
        .route("/api/v1/spirit/inspirations", get(list_inspirations))
        .route("/api/v1/spirit/inspirations/{id}", get(get_inspiration))
        .route("/api/v1/spirit/pains", get(list_pains))
        .route("/api/v1/spirit/pains/{id}", get(get_pain))
        .route("/api/v1/spirit/prompt/preview", get(prompt_preview))
        .route("/api/v1/spirit/stats", get(spirit_stats))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpiritQuery {
    personality_id: Option<String>,
}

/// GET /api/v1/spirit/config — spirit module configuration.
async fn spirit_config(State(state): State<AppState>) -> impl IntoResponse {
    let db_available = state.db().is_some();
    Json(serde_json::json!({
        "enabled": true,
        "dbConnected": db_available,
        "defaultPersonalityId": serde_json::Value::Null,
        "moodDecayRate": 0.05,
        "promptInjection": true,
    }))
    .into_response()
}

async fn list_passions(
    State(state): State<AppState>,
    Query(q): Query<SpiritQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match spirit::list_passions(pool, q.personality_id.as_deref()).await {
        Ok(rows) => Json(serde_json::json!({"passions": rows})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_inspirations(
    State(state): State<AppState>,
    Query(q): Query<SpiritQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match spirit::list_inspirations(pool, q.personality_id.as_deref()).await {
        Ok(rows) => Json(serde_json::json!({"inspirations": rows})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_pains(
    State(state): State<AppState>,
    Query(q): Query<SpiritQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match spirit::list_pains(pool, q.personality_id.as_deref()).await {
        Ok(rows) => Json(serde_json::json!({"pains": rows})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_passion(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match spirit::get_passion(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Passion not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_inspiration(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match spirit::get_inspiration(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Inspiration not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_pain(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match spirit::get_pain(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Pain not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/spirit/prompt/preview — preview the spirit-injected prompt.
async fn prompt_preview(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let passions = spirit::list_passions(pool, None).await.unwrap_or_default();
    let inspirations = spirit::list_inspirations(pool, None)
        .await
        .unwrap_or_default();
    let pains = spirit::list_pains(pool, None).await.unwrap_or_default();
    Json(serde_json::json!({
        "passions": passions.len(),
        "inspirations": inspirations.len(),
        "pains": pains.len(),
        "preview": "Spirit prompt injection preview — aggregated from active passions, inspirations, and pains",
    }))
    .into_response()
}

/// GET /api/v1/spirit/stats — spirit module statistics.
async fn spirit_stats(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let passions = spirit::list_passions(pool, None).await.unwrap_or_default();
    let inspirations = spirit::list_inspirations(pool, None)
        .await
        .unwrap_or_default();
    let pains = spirit::list_pains(pool, None).await.unwrap_or_default();
    Json(serde_json::json!({
        "totalPassions": passions.len(),
        "totalInspirations": inspirations.len(),
        "totalPains": pains.len(),
        "activePassions": passions.iter().filter(|p| p.is_active).count(),
        "activeInspirations": inspirations.iter().filter(|i| i.is_active).count(),
        "activePains": pains.iter().filter(|p| p.is_active).count(),
    }))
    .into_response()
}
