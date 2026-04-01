//! Twitter proxy routes — Twitter/X API v2.
//!
//! Read-only routes use Bearer token auth (app-only).
//! Write routes (post, like, retweet) use OAuth 2.0 user access token.
//! Media upload requires OAuth 1.0a (v1.1) — falls through to Fastify reverse proxy.
//!
//! Credentials from integration config: bearerToken, accessToken.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::integrations::proxy::{self, AuthMode};
use crate::state::AppState;

const TWITTER_V2: &str = "https://api.twitter.com/2";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/twitter/profile", get(profile))
        .route("/api/v1/twitter/timeline", get(timeline))
        .route("/api/v1/twitter/mentions", get(mentions))
        .route("/api/v1/twitter/search", get(search))
        .route("/api/v1/twitter/tweets/{tweetId}", get(get_tweet))
        .route("/api/v1/twitter/users/{username}", get(get_user))
        .route("/api/v1/twitter/tweets", post(post_tweet))
        .route("/api/v1/twitter/tweets/{tweetId}/like", post(like_tweet))
        .route(
            "/api/v1/twitter/tweets/{tweetId}/retweet",
            post(retweet_tweet),
        )
        .route("/api/v1/twitter/media/upload", post(media_upload))
}

/// Resolve Bearer token for read-only v2 API calls.
async fn resolve_bearer(
    state: &AppState,
) -> Result<AuthMode, (StatusCode, Json<serde_json::Value>)> {
    let pool = state.db().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    ))?;
    // Try bearerToken first, fall back to accessToken
    let config = proxy::resolve_config(pool, "twitter").await?;
    let token = config
        .get("bearerToken")
        .or_else(|| config.get("accessToken"))
        .and_then(|v| v.as_str())
        .ok_or((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Twitter integration missing bearerToken or accessToken"})),
        ))?
        .to_string();
    Ok(AuthMode::Bearer(token))
}

/// Resolve OAuth 2.0 user access token for write operations.
async fn resolve_user_token(
    state: &AppState,
) -> Result<AuthMode, (StatusCode, Json<serde_json::Value>)> {
    let pool = state.db().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    ))?;
    let token = proxy::resolve_bearer_token(pool, "twitter", "accessToken").await?;
    Ok(AuthMode::Bearer(token))
}

async fn profile(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(client) = state.twitter() {
        return match client.get_me().await {
            Ok(user) => Json(serde_json::to_value(user).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_bearer(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_get(
        TWITTER_V2,
        "/users/me",
        &auth,
        Some("user.fields=name,username,profile_image_url,description,public_metrics"),
    )
    .await
    .into_response()
}

#[derive(Deserialize)]
struct TimelineQuery {
    max_results: Option<u32>,
    pagination_token: Option<String>,
}

async fn timeline(
    State(state): State<AppState>,
    Query(q): Query<TimelineQuery>,
) -> impl IntoResponse {
    let auth = match resolve_bearer(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    // Need user ID for timeline — get from /users/me first
    let me_res = reqwest::Client::new()
        .get(format!("{TWITTER_V2}/users/me"))
        .bearer_auth(match &auth {
            AuthMode::Bearer(t) => t.as_str(),
            _ => "",
        })
        .send()
        .await;
    let user_id = match me_res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or_default();
            data.get("data")
                .and_then(|d| d.get("id"))
                .and_then(|id| id.as_str())
                .unwrap_or("")
                .to_string()
        }
        _ => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Failed to resolve Twitter user ID"})),
            )
                .into_response();
        }
    };
    let mut params = vec!["tweet.fields=created_at,public_metrics,author_id".to_string()];
    if let Some(max) = q.max_results {
        params.push(format!("max_results={max}"));
    }
    if let Some(ref pt) = q.pagination_token {
        params.push(format!("pagination_token={pt}"));
    }
    proxy::proxy_get(
        TWITTER_V2,
        &format!("/users/{user_id}/tweets"),
        &auth,
        Some(&params.join("&")),
    )
    .await
    .into_response()
}

async fn mentions(
    State(state): State<AppState>,
    Query(q): Query<TimelineQuery>,
) -> impl IntoResponse {
    let auth = match resolve_bearer(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let me_res = reqwest::Client::new()
        .get(format!("{TWITTER_V2}/users/me"))
        .bearer_auth(match &auth {
            AuthMode::Bearer(t) => t.as_str(),
            _ => "",
        })
        .send()
        .await;
    let user_id = match me_res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or_default();
            data.get("data")
                .and_then(|d| d.get("id"))
                .and_then(|id| id.as_str())
                .unwrap_or("")
                .to_string()
        }
        _ => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Failed to resolve Twitter user ID"})),
            )
                .into_response();
        }
    };
    let mut params = vec!["tweet.fields=created_at,public_metrics,author_id".to_string()];
    if let Some(max) = q.max_results {
        params.push(format!("max_results={max}"));
    }
    if let Some(ref pt) = q.pagination_token {
        params.push(format!("pagination_token={pt}"));
    }
    proxy::proxy_get(
        TWITTER_V2,
        &format!("/users/{user_id}/mentions"),
        &auth,
        Some(&params.join("&")),
    )
    .await
    .into_response()
}

#[derive(Deserialize)]
struct SearchQuery {
    query: Option<String>,
    max_results: Option<u32>,
}

async fn search(State(state): State<AppState>, Query(q): Query<SearchQuery>) -> impl IntoResponse {
    let Some(ref query) = q.query else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Missing query parameter"})),
        )
            .into_response();
    };
    if let Some(client) = state.twitter() {
        return match client.search_tweets(query, q.max_results).await {
            Ok(tweets) => Json(serde_json::to_value(tweets).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_bearer(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let mut params = vec![format!(
        "query={}",
        query.replace(' ', "%20").replace('&', "%26")
    )];
    params.push("tweet.fields=created_at,public_metrics,author_id".to_string());
    if let Some(max) = q.max_results {
        params.push(format!("max_results={max}"));
    }
    proxy::proxy_get(
        TWITTER_V2,
        "/tweets/search/recent",
        &auth,
        Some(&params.join("&")),
    )
    .await
    .into_response()
}

async fn get_tweet(
    State(state): State<AppState>,
    Path(tweet_id): Path<String>,
) -> impl IntoResponse {
    let auth = match resolve_bearer(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_get(
        TWITTER_V2,
        &format!("/tweets/{tweet_id}"),
        &auth,
        Some("tweet.fields=created_at,public_metrics,author_id"),
    )
    .await
    .into_response()
}

async fn get_user(
    State(state): State<AppState>,
    Path(username): Path<String>,
) -> impl IntoResponse {
    let auth = match resolve_bearer(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_get(
        TWITTER_V2,
        &format!("/users/by/username/{username}"),
        &auth,
        Some("user.fields=name,username,profile_image_url,description,public_metrics"),
    )
    .await
    .into_response()
}

// ── Write operations (require user access token) ─────────────────────────

async fn post_tweet(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if let Some(client) = state.twitter() {
        let text = body
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        return match client.post_tweet(text).await {
            Ok(tweet) => (
                StatusCode::CREATED,
                Json(serde_json::to_value(tweet).unwrap()),
            )
                .into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_user_token(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_post(TWITTER_V2, "/tweets", &auth, &body)
        .await
        .into_response()
}

async fn like_tweet(
    State(state): State<AppState>,
    Path(tweet_id): Path<String>,
) -> impl IntoResponse {
    let auth = match resolve_user_token(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    // Need user ID for likes endpoint
    let me_res = reqwest::Client::new()
        .get(format!("{TWITTER_V2}/users/me"))
        .bearer_auth(match &auth {
            AuthMode::Bearer(t) => t.as_str(),
            _ => "",
        })
        .send()
        .await;
    let user_id = match me_res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or_default();
            data.get("data")
                .and_then(|d| d.get("id"))
                .and_then(|id| id.as_str())
                .unwrap_or("")
                .to_string()
        }
        _ => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Failed to resolve Twitter user ID"})),
            )
                .into_response();
        }
    };
    proxy::proxy_post(
        TWITTER_V2,
        &format!("/users/{user_id}/likes"),
        &auth,
        &serde_json::json!({"tweet_id": tweet_id}),
    )
    .await
    .into_response()
}

async fn retweet_tweet(
    State(state): State<AppState>,
    Path(tweet_id): Path<String>,
) -> impl IntoResponse {
    let auth = match resolve_user_token(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let me_res = reqwest::Client::new()
        .get(format!("{TWITTER_V2}/users/me"))
        .bearer_auth(match &auth {
            AuthMode::Bearer(t) => t.as_str(),
            _ => "",
        })
        .send()
        .await;
    let user_id = match me_res {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or_default();
            data.get("data")
                .and_then(|d| d.get("id"))
                .and_then(|id| id.as_str())
                .unwrap_or("")
                .to_string()
        }
        _ => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Failed to resolve Twitter user ID"})),
            )
                .into_response();
        }
    };
    proxy::proxy_post(
        TWITTER_V2,
        &format!("/users/{user_id}/retweets"),
        &auth,
        &serde_json::json!({"tweet_id": tweet_id}),
    )
    .await
    .into_response()
}

/// Media upload — requires OAuth 1.0a (v1.1 API), not yet supported in Rust.
async fn media_upload() -> impl IntoResponse {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({
            "error": "Media upload requires OAuth 1.0a (Twitter API v1.1), not yet supported in Rust"
        })),
    )
}
