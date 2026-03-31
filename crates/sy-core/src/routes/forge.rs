//! Forge proxy routes — unified code forge interface (GitHub, GitLab, Bitbucket, Gitea).
//!
//! Connection management and repo/PR/pipeline/branch/release queries.
//! Forge configs stored in-memory via shared state.

use axum::extract::Path;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::state::AppState;

/// In-memory forge connection registry.
type ForgeRegistry = Arc<RwLock<HashMap<String, ForgeConnection>>>;

static FORGES: std::sync::OnceLock<ForgeRegistry> = std::sync::OnceLock::new();

fn forges() -> &'static ForgeRegistry {
    FORGES.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForgeConnection {
    key: String,
    provider: String,
    base_url: String,
    token: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/forge/connections", get(list_connections))
        .route("/api/v1/forge/connections", post(add_connection))
        .route("/api/v1/forge/connections/{key}", delete(remove_connection))
        .route("/api/v1/forge/{key}/health", get(forge_health))
        .route("/api/v1/forge/{key}/repos", get(list_repos))
        .route("/api/v1/forge/{key}/repos/{owner}/{name}", get(get_repo))
        .route(
            "/api/v1/forge/{key}/repos/{owner}/{name}/branches",
            get(list_branches),
        )
        .route(
            "/api/v1/forge/{key}/repos/{owner}/{name}/pulls",
            get(list_pulls),
        )
        .route(
            "/api/v1/forge/{key}/repos/{owner}/{name}/pulls/{number}",
            get(get_pull),
        )
        .route(
            "/api/v1/forge/{key}/repos/{owner}/{name}/releases",
            get(list_releases),
        )
        .route(
            "/api/v1/forge/{key}/repos/{owner}/{name}/pipelines",
            get(list_pipelines),
        )
        .route(
            "/api/v1/forge/{key}/repos/{owner}/{name}/pipelines/trigger",
            post(trigger_pipeline),
        )
        .route(
            "/api/v1/forge/{key}/repos/{owner}/{name}/pipelines/{id}/cancel",
            post(cancel_pipeline),
        )
}

async fn list_connections() -> impl IntoResponse {
    let forges = forges().read().await;
    let connections: Vec<serde_json::Value> = forges
        .values()
        .map(|f| {
            serde_json::json!({
                "key": f.key,
                "provider": f.provider,
                "baseUrl": f.base_url,
            })
        })
        .collect();
    Json(serde_json::json!({ "connections": connections }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddForgeRequest {
    provider: String,
    base_url: String,
    token: String,
}

async fn add_connection(Json(body): Json<AddForgeRequest>) -> impl IntoResponse {
    let key = format!(
        "{}:{}",
        body.provider,
        body.base_url.replace("https://", "").replace("http://", "")
    );
    let conn = ForgeConnection {
        key: key.clone(),
        provider: body.provider,
        base_url: body.base_url.trim_end_matches('/').to_string(),
        token: body.token,
    };
    forges().write().await.insert(key.clone(), conn);
    (StatusCode::CREATED, Json(serde_json::json!({ "key": key })))
}

async fn remove_connection(Path(key): Path<String>) -> impl IntoResponse {
    let removed = forges().write().await.remove(&key).is_some();
    if removed {
        StatusCode::NO_CONTENT.into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Connection not found"})),
        )
            .into_response()
    }
}

/// Resolve a forge connection and build an authenticated GET request.
async fn forge_get(key: &str, api_path: &str) -> axum::response::Response {
    let forges = forges().read().await;
    let Some(conn) = forges.get(key) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Forge connection not found"})),
        )
            .into_response();
    };
    let url = format!("{}{api_path}", conn.base_url);
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

async fn forge_health(Path(key): Path<String>) -> impl IntoResponse {
    forge_get(&key, "/api/v1/health").await
}

async fn list_repos(Path(key): Path<String>) -> impl IntoResponse {
    forge_get(&key, "/api/v1/repos").await
}

async fn get_repo(Path((key, owner, name)): Path<(String, String, String)>) -> impl IntoResponse {
    forge_get(&key, &format!("/api/v1/repos/{owner}/{name}")).await
}

async fn list_branches(
    Path((key, owner, name)): Path<(String, String, String)>,
) -> impl IntoResponse {
    forge_get(&key, &format!("/api/v1/repos/{owner}/{name}/branches")).await
}

async fn list_pulls(Path((key, owner, name)): Path<(String, String, String)>) -> impl IntoResponse {
    forge_get(&key, &format!("/api/v1/repos/{owner}/{name}/pulls")).await
}

async fn get_pull(
    Path((key, owner, name, number)): Path<(String, String, String, String)>,
) -> impl IntoResponse {
    forge_get(
        &key,
        &format!("/api/v1/repos/{owner}/{name}/pulls/{number}"),
    )
    .await
}

async fn list_releases(
    Path((key, owner, name)): Path<(String, String, String)>,
) -> impl IntoResponse {
    forge_get(&key, &format!("/api/v1/repos/{owner}/{name}/releases")).await
}

async fn list_pipelines(
    Path((key, owner, name)): Path<(String, String, String)>,
) -> impl IntoResponse {
    forge_get(&key, &format!("/api/v1/repos/{owner}/{name}/pipelines")).await
}

async fn trigger_pipeline(
    Path((key, owner, name)): Path<(String, String, String)>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let forges = forges().read().await;
    let Some(conn) = forges.get(&key) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Forge connection not found"})),
        )
            .into_response();
    };
    let url = format!(
        "{}/api/v1/repos/{owner}/{name}/pipelines/trigger",
        conn.base_url
    );
    let client = reqwest::Client::new();
    match client
        .post(&url)
        .bearer_auth(&conn.token)
        .json(&body)
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

async fn cancel_pipeline(
    Path((key, owner, name, id)): Path<(String, String, String, String)>,
) -> impl IntoResponse {
    let forges = forges().read().await;
    let Some(conn) = forges.get(&key) else {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Forge connection not found"})),
        )
            .into_response();
    };
    let url = format!(
        "{}/api/v1/repos/{owner}/{name}/pipelines/{id}/cancel",
        conn.base_url
    );
    let client = reqwest::Client::new();
    match client
        .post(&url)
        .bearer_auth(&conn.token)
        .json(&serde_json::json!({}))
        .send()
        .await
    {
        Ok(res) if res.status().is_success() => StatusCode::NO_CONTENT.into_response(),
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
