//! Compliance routes — Statement of Applicability (SOA) management.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::compliance;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/compliance/soa", get(list_soa))
        .route("/api/v1/compliance/soa/summary", get(soa_summary))
        .route("/api/v1/compliance/soa/markdown", get(soa_full_markdown))
        .route("/api/v1/compliance/soa/{id}", get(get_soa))
        .route("/api/v1/compliance/soa/{id}/summary", get(get_soa_summary))
        .route(
            "/api/v1/compliance/soa/{id}/markdown",
            get(get_soa_markdown),
        )
}

#[derive(Deserialize)]
struct PaginationQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

/// GET /api/v1/compliance/soa — list all SOA entries.
async fn list_soa(
    State(state): State<AppState>,
    Query(q): Query<PaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match compliance::list_soa(pool, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/compliance/soa/summary — aggregate SOA summary.
async fn soa_summary(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match compliance::list_soa(pool, 10000, 0).await {
        Ok(rows) => {
            let applicable = rows.iter().filter(|r| r.applicable).count();
            let implemented = rows.iter().filter(|r| r.implemented).count();
            Json(serde_json::json!({
                "total": rows.len(),
                "applicable": applicable,
                "implemented": implemented,
                "coverage": if applicable > 0 { implemented as f64 / applicable as f64 } else { 0.0 },
            }))
            .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/compliance/soa/markdown — full SOA as markdown.
async fn soa_full_markdown(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match compliance::list_soa(pool, 10000, 0).await {
        Ok(rows) => {
            let mut md = String::from(
                "# Statement of Applicability\n\n| Control | Applicable | Implemented | Justification |\n|---------|-----------|-------------|---------------|\n",
            );
            for row in &rows {
                md.push_str(&format!(
                    "| {} | {} | {} | {} |\n",
                    row.control_id,
                    if row.applicable { "Yes" } else { "No" },
                    if row.implemented { "Yes" } else { "No" },
                    row.justification.as_deref().unwrap_or("-"),
                ));
            }
            Json(serde_json::json!({"format": "markdown", "content": md})).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_soa(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match compliance::get_soa(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "SOA entry not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/compliance/soa/{id}/summary — single SOA entry summary.
async fn get_soa_summary(
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
    match compliance::get_soa(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "id": row.id,
            "controlId": row.control_id,
            "applicable": row.applicable,
            "implemented": row.implemented,
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "SOA entry not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/compliance/soa/{id}/markdown — single SOA entry as markdown.
async fn get_soa_markdown(
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
    match compliance::get_soa(pool, &id).await {
        Ok(Some(row)) => {
            let md = format!(
                "## {}\n\n- **Applicable**: {}\n- **Implemented**: {}\n- **Justification**: {}\n",
                row.control_id,
                if row.applicable { "Yes" } else { "No" },
                if row.implemented { "Yes" } else { "No" },
                row.justification.as_deref().unwrap_or("N/A"),
            );
            Json(serde_json::json!({"format": "markdown", "content": md})).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "SOA entry not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
