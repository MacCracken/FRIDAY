//! Gmail proxy routes — Gmail API v1.
//!
//! Credentials: OAuth Bearer token from integration config `accessToken` field.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::integrations::proxy::{self, AuthMode};
use crate::state::AppState;

const GMAIL_API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/gmail/profile", get(profile))
        .route("/api/v1/gmail/messages", get(list_messages))
        .route("/api/v1/gmail/messages/{messageId}", get(get_message))
        .route("/api/v1/gmail/threads/{threadId}", get(get_thread))
        .route("/api/v1/gmail/messages/send", post(send_message))
        .route("/api/v1/gmail/send", post(send_message))
        .route("/api/v1/gmail/drafts", post(create_draft))
        .route("/api/v1/gmail/labels", get(list_labels))
}

async fn resolve_auth(state: &AppState) -> Result<AuthMode, (StatusCode, Json<serde_json::Value>)> {
    let pool = state.db().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    ))?;
    let token = proxy::resolve_bearer_token(pool, "gmail", "accessToken").await?;
    Ok(AuthMode::Bearer(token))
}

async fn profile(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(client) = state.gmail() {
        return match client.get_profile().await {
            Ok(p) => Json(serde_json::to_value(p).unwrap()).into_response(),
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
    proxy::proxy_get(GMAIL_API, "/profile", &auth, None)
        .await
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessagesQuery {
    q: Option<String>,
    max_results: Option<u32>,
    page_token: Option<String>,
    label_ids: Option<String>,
}

async fn list_messages(
    State(state): State<AppState>,
    Query(q): Query<MessagesQuery>,
) -> impl IntoResponse {
    if let Some(client) = state.gmail() {
        return match client.list_messages(q.q.as_deref(), q.max_results).await {
            Ok(msgs) => Json(serde_json::to_value(msgs).unwrap()).into_response(),
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
    let mut params = Vec::new();
    if let Some(ref query) = q.q {
        params.push(format!("q={query}"));
    }
    if let Some(max) = q.max_results {
        params.push(format!("maxResults={max}"));
    }
    if let Some(ref pt) = q.page_token {
        params.push(format!("pageToken={pt}"));
    }
    if let Some(ref labels) = q.label_ids {
        params.push(format!("labelIds={labels}"));
    }
    let qs = if params.is_empty() {
        None
    } else {
        Some(params.join("&"))
    };
    proxy::proxy_get(GMAIL_API, "/messages", &auth, qs.as_deref())
        .await
        .into_response()
}

#[derive(Deserialize)]
struct MessageQuery {
    format: Option<String>,
}

async fn get_message(
    State(state): State<AppState>,
    Path(message_id): Path<String>,
    Query(q): Query<MessageQuery>,
) -> impl IntoResponse {
    if let Some(client) = state.gmail() {
        return match client.get_message(&message_id).await {
            Ok(msg) => Json(serde_json::to_value(msg).unwrap()).into_response(),
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
    let fmt = q.format.as_deref().unwrap_or("full");
    proxy::proxy_get(
        GMAIL_API,
        &format!("/messages/{message_id}"),
        &auth,
        Some(&format!("format={fmt}")),
    )
    .await
    .into_response()
}

async fn get_thread(
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
) -> impl IntoResponse {
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_get(GMAIL_API, &format!("/threads/{thread_id}"), &auth, None)
        .await
        .into_response()
}

async fn send_message(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    if let Some(client) = state.gmail() {
        let to = body
            .get("to")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let subject = body
            .get("subject")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let text = body
            .get("body")
            .or_else(|| body.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        return match client.send_message(&to, &subject, &text).await {
            Ok(msg) => (
                StatusCode::CREATED,
                Json(serde_json::to_value(msg).unwrap()),
            )
                .into_response(),
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
    proxy::proxy_post(GMAIL_API, "/messages/send", &auth, &body)
        .await
        .into_response()
}

async fn create_draft(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_post(GMAIL_API, "/drafts", &auth, &body)
        .await
        .into_response()
}

async fn list_labels(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(client) = state.gmail() {
        return match client.list_labels().await {
            Ok(labels) => Json(serde_json::to_value(labels).unwrap()).into_response(),
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
    proxy::proxy_get(GMAIL_API, "/labels", &auth, None)
        .await
        .into_response()
}
