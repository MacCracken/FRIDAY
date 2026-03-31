//! Editor routes — search, replace, and annotation management.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::editor;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/editor/search", get(editor_search))
        .route("/api/v1/editor/replace", post(editor_replace))
        .route("/api/v1/editor/annotations", get(list_annotations))
        .route("/api/v1/editor/annotations/{id}", get(get_annotation))
        .route(
            "/api/v1/editor/annotations/export",
            post(export_annotations),
        )
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

/// GET /api/v1/editor/search — search editor content.
///
/// Delegates to the workspace file index in production.  Stub for now.
async fn editor_search(Query(q): Query<SearchQuery>) -> impl IntoResponse {
    Json(serde_json::json!({
        "query": q.q,
        "results": [],
        "total": 0,
        "message": "Search index not yet connected",
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplaceRequest {
    search: String,
    replace: String,
    file_path: Option<String>,
    dry_run: Option<bool>,
}

/// POST /api/v1/editor/replace — search and replace in workspace.
async fn editor_replace(Json(body): Json<ReplaceRequest>) -> impl IntoResponse {
    let dry = body.dry_run.unwrap_or(true);
    Json(serde_json::json!({
        "search": body.search,
        "replace": body.replace,
        "filePath": body.file_path,
        "dryRun": dry,
        "matchesFound": 0,
        "replacementsMade": 0,
        "message": if dry { "Dry run — no changes made" } else { "Replace engine not yet connected" },
    }))
    .into_response()
}

async fn list_annotations(
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match editor::list_annotations(pool, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_annotation(
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
    match editor::get_annotation(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Annotation not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/v1/editor/annotations/export — export all annotations.
async fn export_annotations(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match editor::list_annotations(pool, 10000, 0).await {
        Ok(rows) => Json(serde_json::json!({
            "format": "json",
            "total": rows.len(),
            "annotations": rows,
        }))
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
