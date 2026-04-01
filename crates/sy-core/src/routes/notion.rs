//! Notion proxy routes — Notion API v1.
//!
//! Credentials: Bearer token from integration config `apiToken` field, or
//! `NOTION_API_KEY` env var when the typed client is configured.
//! Requires Notion-Version header.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::integrations::proxy::{self, AuthMode};
use crate::state::AppState;

const NOTION_API: &str = "https://api.notion.com/v1";
const NOTION_VERSION: &str = "2022-06-28";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/integrations/notion/search", get(search))
        .route("/api/v1/integrations/notion/pages/{id}", get(get_page))
        .route(
            "/api/v1/integrations/notion/pages/{id}/blocks",
            get(get_page_blocks).post(append_blocks),
        )
        .route(
            "/api/v1/integrations/notion/databases/{id}",
            get(get_database),
        )
        .route(
            "/api/v1/integrations/notion/databases/{id}/query",
            post(query_database),
        )
}

async fn resolve_auth(state: &AppState) -> Result<AuthMode, (StatusCode, Json<serde_json::Value>)> {
    let pool = state.db().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    ))?;
    let token = proxy::resolve_bearer_token(pool, "notion", "apiToken").await?;
    Ok(AuthMode::Bearer(token))
}

/// Notion search requires POST with Notion-Version header.
/// We use a custom fetch here since proxy_post doesn't add extra headers.
async fn notion_post(auth: &AuthMode, path: &str, body: &serde_json::Value) -> impl IntoResponse {
    let url = format!("{NOTION_API}{path}");
    let client = reqwest::Client::new();
    let mut req = client
        .post(&url)
        .header("Notion-Version", NOTION_VERSION)
        .json(body);

    req = match auth {
        AuthMode::Bearer(token) => req.bearer_auth(token),
        _ => req,
    };

    match req.send().await {
        Ok(res) if res.status().is_success() => {
            let body: serde_json::Value = res.json().await.unwrap_or(serde_json::json!(null));
            (StatusCode::OK, Json(body)).into_response()
        }
        Ok(res) => {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": body})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Notion request failed: {e}")})),
        )
            .into_response(),
    }
}

/// Notion GET with Notion-Version header.
async fn notion_get(auth: &AuthMode, path: &str) -> impl IntoResponse {
    let url = format!("{NOTION_API}{path}");
    let client = reqwest::Client::new();
    let mut req = client.get(&url).header("Notion-Version", NOTION_VERSION);

    req = match auth {
        AuthMode::Bearer(token) => req.bearer_auth(token),
        _ => req,
    };

    match req.send().await {
        Ok(res) if res.status().is_success() => {
            let body: serde_json::Value = res.json().await.unwrap_or(serde_json::json!(null));
            (StatusCode::OK, Json(body)).into_response()
        }
        Ok(res) => {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": body})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Notion request failed: {e}")})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct SearchQuery {
    query: Option<String>,
}

async fn search(State(state): State<AppState>, Query(q): Query<SearchQuery>) -> impl IntoResponse {
    if let Some(client) = state.notion() {
        let query_str = q.query.as_deref().unwrap_or("");
        return match client.search(query_str, None).await {
            Ok(result) => Json(serde_json::to_value(result).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let body = serde_json::json!({
        "query": q.query.unwrap_or_default(),
    });
    notion_post(&auth, "/search", &body).await.into_response()
}

async fn get_page(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    if let Some(client) = state.notion() {
        return match client.get_page(&id).await {
            Ok(page) => Json(serde_json::to_value(page).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    notion_get(&auth, &format!("/pages/{id}"))
        .await
        .into_response()
}

async fn get_database(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    if let Some(client) = state.notion() {
        return match client.get_database(&id).await {
            Ok(db) => Json(serde_json::to_value(db).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    notion_get(&auth, &format!("/databases/{id}"))
        .await
        .into_response()
}

async fn get_page_blocks(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Some(client) = state.notion() {
        return match client.get_blocks(&id).await {
            Ok(blocks) => Json(serde_json::to_value(blocks).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    notion_get(&auth, &format!("/blocks/{id}/children"))
        .await
        .into_response()
}

async fn append_blocks(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    notion_post(&auth, &format!("/blocks/{id}/children"), &body)
        .await
        .into_response()
}

async fn query_database(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if let Some(client) = state.notion() {
        let filter = body.get("filter");
        let sorts = body.get("sorts");
        return match client.query_database(&id, filter, sorts).await {
            Ok(result) => Json(serde_json::to_value(result).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    notion_post(&auth, &format!("/databases/{id}/query"), &body)
        .await
        .into_response()
}
