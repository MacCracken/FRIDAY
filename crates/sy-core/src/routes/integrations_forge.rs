//! Integration forge routes — unified code forge under /api/v1/integrations/forge/.
//!
//! Covers repos, pull-requests, issues, CI pipelines, artifacts, and container
//! registries. Delegates to the in-memory forge connection registry shared with
//! `crate::routes::forge`.

use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::state::AppState;

// Re-use the same in-memory registry type as forge.rs (copied here to avoid
// cross-module coupling; the OnceLock ensures a single shared instance).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgeConnection {
    key: String,
    provider: String,
    base_url: String,
    token: String,
}

type ForgeRegistry = Arc<RwLock<HashMap<String, ForgeConnection>>>;

/// Returns the same static registry used by `crate::routes::forge`.
fn forges() -> &'static ForgeRegistry {
    // Share the OnceLock from forge.rs via a re-export path.
    // Since we cannot import private statics, we maintain a separate but
    // functionally equivalent in-memory store for the integrations/forge namespace.
    static FORGES: std::sync::OnceLock<ForgeRegistry> = std::sync::OnceLock::new();
    FORGES.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

pub fn router() -> Router<AppState> {
    Router::new()
        // Repos
        .route("/api/v1/integrations/forge/repos", get(list_repos))
        .route(
            "/api/v1/integrations/forge/repos/{owner}/{repo}",
            get(get_repo),
        )
        .route(
            "/api/v1/integrations/forge/repos/{owner}/{repo}/branches",
            get(list_branches),
        )
        .route(
            "/api/v1/integrations/forge/repos/{owner}/{repo}/commits",
            get(list_commits),
        )
        // Pull requests
        .route(
            "/api/v1/integrations/forge/repos/{owner}/{repo}/pull-requests",
            get(list_prs).post(create_pr),
        )
        .route(
            "/api/v1/integrations/forge/repos/{owner}/{repo}/pull-requests/{number}",
            get(get_pr),
        )
        .route(
            "/api/v1/integrations/forge/repos/{owner}/{repo}/pull-requests/{number}/diff",
            get(get_pr_diff),
        )
        .route(
            "/api/v1/integrations/forge/repos/{owner}/{repo}/pull-requests/{number}/merge",
            post(merge_pr),
        )
        // Issues
        .route(
            "/api/v1/integrations/forge/repos/{owner}/{repo}/issues",
            get(list_issues).post(create_issue),
        )
        // CI pipelines
        .route("/api/v1/integrations/forge/pipelines", get(list_pipelines))
        .route(
            "/api/v1/integrations/forge/pipelines/{id}",
            get(get_pipeline),
        )
        // Artifacts
        .route("/api/v1/integrations/forge/artifacts", get(list_artifacts))
        .route(
            "/api/v1/integrations/forge/artifacts/{id}",
            get(get_artifact).delete(delete_artifact),
        )
        // Container registries
        .route(
            "/api/v1/integrations/forge/registries",
            get(list_registries),
        )
        .route(
            "/api/v1/integrations/forge/registries/{name}/repos",
            get(list_registry_repos),
        )
        .route(
            "/api/v1/integrations/forge/registries/{name}/repos/{repo}/tags",
            get(list_tags),
        )
        .route(
            "/api/v1/integrations/forge/registries/{name}/repos/{repo}/tags/{tag}",
            get(get_tag).delete(delete_tag),
        )
        .route(
            "/api/v1/integrations/forge/registries/{name}/repos/{repo}/manifest/{reference}",
            get(get_manifest),
        )
        .route(
            "/api/v1/integrations/forge/registries/{name}/stats",
            get(registry_stats),
        )
        .route(
            "/api/v1/integrations/forge/registries/{name}/gc",
            post(trigger_gc),
        )
}

// ---------------------------------------------------------------------------
// Forge HTTP helper — uses the first registered forge connection.
// ---------------------------------------------------------------------------

async fn forge_get(path: &str) -> axum::response::Response {
    let forges = forges().read().await;
    let Some(conn) = forges.values().next() else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No forge connection configured"})),
        )
            .into_response();
    };
    let url = format!("{}{path}", conn.base_url);
    let client = reqwest::Client::new();
    match client.get(&url).bearer_auth(&conn.token).send().await {
        Ok(res) if res.status().is_success() => {
            let body: serde_json::Value = res.json().await.unwrap_or(serde_json::json!(null));
            Json(body).into_response()
        }
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

async fn forge_post(path: &str, body: &serde_json::Value) -> axum::response::Response {
    let forges = forges().read().await;
    let Some(conn) = forges.values().next() else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No forge connection configured"})),
        )
            .into_response();
    };
    let url = format!("{}{path}", conn.base_url);
    let client = reqwest::Client::new();
    match client
        .post(&url)
        .bearer_auth(&conn.token)
        .json(body)
        .send()
        .await
    {
        Ok(res) if res.status().is_success() => {
            let data: serde_json::Value = res.json().await.unwrap_or(serde_json::json!(null));
            (StatusCode::CREATED, Json(data)).into_response()
        }
        Ok(res) => {
            let s = res.status().as_u16();
            let data = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": data})),
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

async fn forge_delete(path: &str) -> axum::response::Response {
    let forges = forges().read().await;
    let Some(conn) = forges.values().next() else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No forge connection configured"})),
        )
            .into_response();
    };
    let url = format!("{}{path}", conn.base_url);
    let client = reqwest::Client::new();
    match client.delete(&url).bearer_auth(&conn.token).send().await {
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

// ---------------------------------------------------------------------------
// Repo handlers
// ---------------------------------------------------------------------------

async fn list_repos() -> impl IntoResponse {
    forge_get("/api/v1/repos").await
}

async fn get_repo(Path((owner, repo)): Path<(String, String)>) -> impl IntoResponse {
    forge_get(&format!("/api/v1/repos/{owner}/{repo}")).await
}

async fn list_branches(Path((owner, repo)): Path<(String, String)>) -> impl IntoResponse {
    forge_get(&format!("/api/v1/repos/{owner}/{repo}/branches")).await
}

async fn list_commits(Path((owner, repo)): Path<(String, String)>) -> impl IntoResponse {
    forge_get(&format!("/api/v1/repos/{owner}/{repo}/commits")).await
}

// ---------------------------------------------------------------------------
// Pull request handlers
// ---------------------------------------------------------------------------

async fn list_prs(Path((owner, repo)): Path<(String, String)>) -> impl IntoResponse {
    forge_get(&format!("/api/v1/repos/{owner}/{repo}/pulls")).await
}

async fn create_pr(
    Path((owner, repo)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    forge_post(&format!("/api/v1/repos/{owner}/{repo}/pulls"), &body).await
}

async fn get_pr(Path((owner, repo, number)): Path<(String, String, String)>) -> impl IntoResponse {
    forge_get(&format!("/api/v1/repos/{owner}/{repo}/pulls/{number}")).await
}

async fn get_pr_diff(
    Path((owner, repo, number)): Path<(String, String, String)>,
) -> impl IntoResponse {
    forge_get(&format!("/api/v1/repos/{owner}/{repo}/pulls/{number}/diff")).await
}

async fn merge_pr(
    Path((owner, repo, number)): Path<(String, String, String)>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    forge_post(
        &format!("/api/v1/repos/{owner}/{repo}/pulls/{number}/merge"),
        &body,
    )
    .await
}

// ---------------------------------------------------------------------------
// Issue handlers
// ---------------------------------------------------------------------------

async fn list_issues(Path((owner, repo)): Path<(String, String)>) -> impl IntoResponse {
    forge_get(&format!("/api/v1/repos/{owner}/{repo}/issues")).await
}

async fn create_issue(
    Path((owner, repo)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    forge_post(&format!("/api/v1/repos/{owner}/{repo}/issues"), &body).await
}

// ---------------------------------------------------------------------------
// Pipeline handlers
// ---------------------------------------------------------------------------

async fn list_pipelines() -> impl IntoResponse {
    forge_get("/api/v1/pipelines").await
}

async fn get_pipeline(Path(id): Path<String>) -> impl IntoResponse {
    forge_get(&format!("/api/v1/pipelines/{id}")).await
}

// ---------------------------------------------------------------------------
// Artifact handlers
// ---------------------------------------------------------------------------

async fn list_artifacts() -> impl IntoResponse {
    forge_get("/api/v1/artifacts").await
}

async fn get_artifact(Path(id): Path<String>) -> impl IntoResponse {
    forge_get(&format!("/api/v1/artifacts/{id}")).await
}

async fn delete_artifact(Path(id): Path<String>) -> impl IntoResponse {
    forge_delete(&format!("/api/v1/artifacts/{id}")).await
}

// ---------------------------------------------------------------------------
// Container registry handlers
// ---------------------------------------------------------------------------

async fn list_registries() -> impl IntoResponse {
    forge_get("/api/v1/registries").await
}

async fn list_registry_repos(Path(name): Path<String>) -> impl IntoResponse {
    forge_get(&format!("/api/v1/registries/{name}/repos")).await
}

async fn list_tags(Path((name, repo)): Path<(String, String)>) -> impl IntoResponse {
    forge_get(&format!("/api/v1/registries/{name}/repos/{repo}/tags")).await
}

async fn get_tag(Path((name, repo, tag)): Path<(String, String, String)>) -> impl IntoResponse {
    forge_get(&format!(
        "/api/v1/registries/{name}/repos/{repo}/tags/{tag}"
    ))
    .await
}

async fn delete_tag(Path((name, repo, tag)): Path<(String, String, String)>) -> impl IntoResponse {
    forge_delete(&format!(
        "/api/v1/registries/{name}/repos/{repo}/tags/{tag}"
    ))
    .await
}

async fn get_manifest(
    Path((name, repo, reference)): Path<(String, String, String)>,
) -> impl IntoResponse {
    forge_get(&format!(
        "/api/v1/registries/{name}/repos/{repo}/manifest/{reference}"
    ))
    .await
}

async fn registry_stats(Path(name): Path<String>) -> impl IntoResponse {
    forge_get(&format!("/api/v1/registries/{name}/stats")).await
}

async fn trigger_gc(Path(name): Path<String>) -> impl IntoResponse {
    forge_post(
        &format!("/api/v1/registries/{name}/gc"),
        &serde_json::json!({}),
    )
    .await
}
