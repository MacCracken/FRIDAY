//! Jira proxy routes — Jira REST API v3.
//!
//! Credentials: Basic auth (email:apiToken base64) from integration config.
//! Instance URL from config `instanceUrl` field.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::integrations::proxy::{self, AuthMode};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/integrations/jira/issues/search",
            get(search_issues),
        )
        .route("/api/v1/integrations/jira/issues/{key}", get(get_issue))
        .route("/api/v1/integrations/jira/projects", get(list_projects))
}

async fn resolve_jira(
    state: &AppState,
) -> Result<(String, AuthMode), (StatusCode, Json<serde_json::Value>)> {
    let pool = state.db().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    ))?;
    let config = proxy::resolve_config(pool, "jira").await?;
    let instance_url = config
        .get("instanceUrl")
        .and_then(|v| v.as_str())
        .ok_or((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Jira integration missing instanceUrl"})),
        ))?
        .trim_end_matches('/')
        .to_string();
    let email = config.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let api_token = config.get("apiToken").and_then(|v| v.as_str()).ok_or((
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"error": "Jira integration missing apiToken"})),
    ))?;

    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(format!("{email}:{api_token}"));
    Ok((instance_url, AuthMode::Basic(encoded)))
}

#[derive(Deserialize)]
struct SearchQuery {
    jql: Option<String>,
    #[serde(rename = "maxResults")]
    max_results: Option<u32>,
    #[serde(rename = "startAt")]
    start_at: Option<u32>,
}

async fn search_issues(
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> impl IntoResponse {
    let (base_url, auth) = match resolve_jira(&state).await {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    let mut params = Vec::new();
    if let Some(ref jql) = q.jql {
        params.push(format!("jql={}", jql.replace(' ', "%20")));
    }
    if let Some(max) = q.max_results {
        params.push(format!("maxResults={max}"));
    }
    if let Some(start) = q.start_at {
        params.push(format!("startAt={start}"));
    }
    let qs = if params.is_empty() {
        None
    } else {
        Some(params.join("&"))
    };
    proxy::proxy_get(
        &format!("{base_url}/rest/api/3"),
        "/search",
        &auth,
        qs.as_deref(),
    )
    .await
    .into_response()
}

async fn get_issue(State(state): State<AppState>, Path(key): Path<String>) -> impl IntoResponse {
    let (base_url, auth) = match resolve_jira(&state).await {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_get(
        &format!("{base_url}/rest/api/3"),
        &format!("/issue/{key}"),
        &auth,
        None,
    )
    .await
    .into_response()
}

async fn list_projects(State(state): State<AppState>) -> impl IntoResponse {
    let (base_url, auth) = match resolve_jira(&state).await {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_get(&format!("{base_url}/rest/api/3"), "/project", &auth, None)
        .await
        .into_response()
}
