//! GitHub proxy routes — GitHub REST API v3.
//!
//! Credentials: OAuth Bearer token from integration config `accessToken` field,
//! or `GITHUB_TOKEN` env var when the typed client is configured.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::integrations::proxy::{self, AuthMode};
use crate::state::AppState;

const GITHUB_API: &str = "https://api.github.com";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/github/profile", get(profile))
        .route("/api/v1/github/repos", get(list_repos))
        .route("/api/v1/github/repos/{owner}/{repo}", get(get_repo))
        .route(
            "/api/v1/github/repos/{owner}/{repo}/issues",
            get(list_issues),
        )
        .route(
            "/api/v1/github/repos/{owner}/{repo}/issues/{number}",
            get(get_issue),
        )
        .route("/api/v1/github/repos/{owner}/{repo}/pulls", get(list_pulls))
        .route(
            "/api/v1/github/repos/{owner}/{repo}/pulls/{number}",
            get(get_pull),
        )
        .route(
            "/api/v1/github/repos/{owner}/{repo}/issues",
            post(create_issue),
        )
        .route(
            "/api/v1/github/repos/{owner}/{repo}/issues/{number}/comments",
            post(create_comment),
        )
        .route("/api/v1/github/ssh-keys", get(list_ssh_keys))
        .route("/api/v1/github/ssh-keys", post(create_ssh_key))
        .route("/api/v1/github/ssh-keys/{key_id}", delete(delete_ssh_key))
        .route(
            "/api/v1/github/repos/{owner}/{repo}/pulls",
            post(create_pull),
        )
        .route(
            "/api/v1/github/repos/{owner}/{repo}/actions/runs",
            get(list_workflow_runs),
        )
        .route(
            "/api/v1/github/repos/{owner}/{repo}/branches",
            get(list_branches),
        )
        .route(
            "/api/v1/github/repos/{owner}/{repo}/commits",
            get(list_commits),
        )
        .route(
            "/api/v1/github/repos/{owner}/{repo}/forks",
            post(create_fork),
        )
        .route(
            "/api/v1/github/repos/{owner}/{repo}/sync-fork",
            post(sync_fork),
        )
}

async fn resolve_auth(state: &AppState) -> Result<AuthMode, (StatusCode, Json<serde_json::Value>)> {
    let pool = state.db().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    ))?;
    let token = proxy::resolve_bearer_token(pool, "github", "accessToken").await?;
    Ok(AuthMode::Bearer(token))
}

async fn gh_get(state: &AppState, path: &str, qs: Option<&str>) -> axum::response::Response {
    let auth = match resolve_auth(state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_get(GITHUB_API, path, &auth, qs)
        .await
        .into_response()
}

async fn gh_post(
    state: &AppState,
    path: &str,
    body: &serde_json::Value,
) -> axum::response::Response {
    let auth = match resolve_auth(state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_post(GITHUB_API, path, &auth, body)
        .await
        .into_response()
}

async fn profile(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(client) = state.github() {
        return match client.get_user().await {
            Ok(user) => Json(serde_json::to_value(user).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    gh_get(&state, "/user", None).await
}

#[derive(Deserialize)]
struct RepoQuery {
    r#type: Option<String>,
    sort: Option<String>,
    per_page: Option<String>,
    page: Option<String>,
}

async fn list_repos(
    State(state): State<AppState>,
    Query(q): Query<RepoQuery>,
) -> impl IntoResponse {
    if let Some(client) = state.github() {
        let page: u32 = q.page.as_deref().and_then(|s| s.parse().ok()).unwrap_or(1);
        let per_page: u32 = q
            .per_page
            .as_deref()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);
        return match client.list_repos(page, per_page).await {
            Ok(repos) => Json(serde_json::to_value(repos).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let mut params = Vec::new();
    if let Some(ref t) = q.r#type {
        params.push(format!("type={t}"));
    }
    if let Some(ref s) = q.sort {
        params.push(format!("sort={s}"));
    }
    if let Some(ref pp) = q.per_page {
        params.push(format!("per_page={pp}"));
    }
    if let Some(ref p) = q.page {
        params.push(format!("page={p}"));
    }
    let qs = if params.is_empty() {
        None
    } else {
        Some(params.join("&"))
    };
    gh_get(&state, "/user/repos", qs.as_deref()).await
}

async fn get_repo(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Some(client) = state.github() {
        return match client.get_repo(&owner, &repo).await {
            Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    gh_get(&state, &format!("/repos/{owner}/{repo}"), None).await
}

#[derive(Deserialize)]
struct IssueQuery {
    state: Option<String>,
    per_page: Option<String>,
    page: Option<String>,
}

async fn list_issues(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
    Query(q): Query<IssueQuery>,
) -> impl IntoResponse {
    if let Some(client) = state.github() {
        let state_str = q.state.as_deref().unwrap_or("open");
        let page: u32 = q.page.as_deref().and_then(|s| s.parse().ok()).unwrap_or(1);
        return match client.list_issues(&owner, &repo, state_str, page).await {
            Ok(issues) => Json(serde_json::to_value(issues).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let mut params = Vec::new();
    if let Some(ref s) = q.state {
        params.push(format!("state={s}"));
    }
    if let Some(ref pp) = q.per_page {
        params.push(format!("per_page={pp}"));
    }
    if let Some(ref p) = q.page {
        params.push(format!("page={p}"));
    }
    let qs = if params.is_empty() {
        None
    } else {
        Some(params.join("&"))
    };
    gh_get(
        &state,
        &format!("/repos/{owner}/{repo}/issues"),
        qs.as_deref(),
    )
    .await
}

async fn get_issue(
    State(state): State<AppState>,
    Path((owner, repo, number)): Path<(String, String, String)>,
) -> impl IntoResponse {
    // Note: typed client doesn't have a per-issue get, fall through to proxy.
    gh_get(
        &state,
        &format!("/repos/{owner}/{repo}/issues/{number}"),
        None,
    )
    .await
}

async fn list_pulls(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
    Query(q): Query<IssueQuery>,
) -> impl IntoResponse {
    if let Some(client) = state.github() {
        let state_str = q.state.as_deref().unwrap_or("open");
        let page: u32 = q.page.as_deref().and_then(|s| s.parse().ok()).unwrap_or(1);
        return match client.list_pulls(&owner, &repo, state_str, page).await {
            Ok(pulls) => Json(serde_json::to_value(pulls).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let mut params = Vec::new();
    if let Some(ref s) = q.state {
        params.push(format!("state={s}"));
    }
    if let Some(ref pp) = q.per_page {
        params.push(format!("per_page={pp}"));
    }
    if let Some(ref p) = q.page {
        params.push(format!("page={p}"));
    }
    let qs = if params.is_empty() {
        None
    } else {
        Some(params.join("&"))
    };
    gh_get(
        &state,
        &format!("/repos/{owner}/{repo}/pulls"),
        qs.as_deref(),
    )
    .await
}

async fn get_pull(
    State(state): State<AppState>,
    Path((owner, repo, number)): Path<(String, String, String)>,
) -> impl IntoResponse {
    gh_get(
        &state,
        &format!("/repos/{owner}/{repo}/pulls/{number}"),
        None,
    )
    .await
}

async fn create_issue(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if let Some(client) = state.github() {
        let title = body
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let issue_body = body.get("body").and_then(|v| v.as_str()).map(String::from);
        let labels: Vec<String> = body
            .get("labels")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|l| l.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        return match client
            .create_issue(&owner, &repo, &title, issue_body.as_deref(), labels)
            .await
        {
            Ok(issue) => (
                StatusCode::CREATED,
                Json(serde_json::to_value(issue).unwrap()),
            )
                .into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    gh_post(&state, &format!("/repos/{owner}/{repo}/issues"), &body).await
}

async fn create_comment(
    State(state): State<AppState>,
    Path((owner, repo, number)): Path<(String, String, String)>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    gh_post(
        &state,
        &format!("/repos/{owner}/{repo}/issues/{number}/comments"),
        &body,
    )
    .await
}

async fn list_ssh_keys(State(state): State<AppState>) -> impl IntoResponse {
    gh_get(&state, "/user/keys", None).await
}

async fn create_ssh_key(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    gh_post(&state, "/user/keys", &body).await
}

async fn delete_ssh_key(
    State(state): State<AppState>,
    Path(key_id): Path<String>,
) -> impl IntoResponse {
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let url = format!("{GITHUB_API}/user/keys/{key_id}");
    let client = reqwest::Client::new();
    let mut req = client.delete(&url);
    if let AuthMode::Bearer(ref token) = auth {
        req = req.bearer_auth(token);
    }
    match req.send().await {
        Ok(res) if res.status().is_success() => StatusCode::NO_CONTENT.into_response(),
        Ok(res) => {
            let s = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": body})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn create_pull(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    gh_post(&state, &format!("/repos/{owner}/{repo}/pulls"), &body).await
}

async fn list_workflow_runs(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
) -> impl IntoResponse {
    gh_get(
        &state,
        &format!("/repos/{owner}/{repo}/actions/runs"),
        Some("per_page=10"),
    )
    .await
}

async fn list_branches(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Some(client) = state.github() {
        return match client.list_branches(&owner, &repo).await {
            Ok(branches) => Json(serde_json::to_value(branches).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    gh_get(&state, &format!("/repos/{owner}/{repo}/branches"), None).await
}

async fn list_commits(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
    Query(q): Query<IssueQuery>,
) -> impl IntoResponse {
    if let Some(client) = state.github() {
        let page: u32 = q.page.as_deref().and_then(|s| s.parse().ok()).unwrap_or(1);
        return match client.list_commits(&owner, &repo, None, page).await {
            Ok(commits) => Json(serde_json::to_value(commits).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let mut params = Vec::new();
    if let Some(ref pp) = q.per_page {
        params.push(format!("per_page={pp}"));
    }
    if let Some(ref p) = q.page {
        params.push(format!("page={p}"));
    }
    let qs = if params.is_empty() {
        None
    } else {
        Some(params.join("&"))
    };
    gh_get(
        &state,
        &format!("/repos/{owner}/{repo}/commits"),
        qs.as_deref(),
    )
    .await
}

async fn create_fork(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    gh_post(&state, &format!("/repos/{owner}/{repo}/forks"), &body).await
}

async fn sync_fork(
    State(state): State<AppState>,
    Path((owner, repo)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    gh_post(
        &state,
        &format!("/repos/{owner}/{repo}/merge-upstream"),
        &body,
    )
    .await
}
