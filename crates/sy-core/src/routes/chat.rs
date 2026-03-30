//! Chat routes — conversation/message CRUD and streaming chat completion.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use std::convert::Infallible;

use crate::db::chat;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/conversations", get(list_conversations))
        .route("/api/v1/conversations", post(create_conversation))
        .route("/api/v1/conversations/{id}", get(get_conversation))
        .route("/api/v1/conversations/{id}", delete(delete_conversation))
        .route("/api/v1/conversations/{id}/messages", get(list_messages))
        .route("/api/v1/chat/stream", post(chat_stream))
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

async fn list_conversations(
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
    match chat::list_conversations(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateConversationRequest {
    #[serde(default = "default_title")]
    title: String,
    personality_id: Option<String>,
}
fn default_title() -> String {
    "New Conversation".to_string()
}

async fn create_conversation(
    State(state): State<AppState>,
    Json(body): Json<CreateConversationRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match chat::create_conversation(
        pool,
        &id,
        &body.title,
        body.personality_id.as_deref(),
        "default",
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_conversation(
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
    match chat::get_conversation(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Conversation not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_conversation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match chat::delete_conversation(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Conversation not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_messages(
    State(state): State<AppState>,
    Path(conversation_id): Path<String>,
    Query(q): Query<PaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match chat::list_messages(pool, &conversation_id, q.limit.min(200), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Chat Streaming (SSE) ─────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatStreamRequest {
    message: String,
    #[serde(default)]
    history: Vec<ChatMessage>,
    personality_id: Option<String>,
    conversation_id: Option<String>,
    model: Option<String>,
}

#[derive(Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

fn hoosh_base_url() -> String {
    std::env::var("HOOSH_URL").unwrap_or_else(|_| "http://127.0.0.1:8088".to_string())
}

/// POST /api/v1/chat/stream — stream chat completion tokens via SSE.
///
/// Proxies to hoosh's OpenAI-compatible /v1/chat/completions with stream:true.
/// Maps OpenAI SSE chunks to SY ChatStreamEvent format:
/// - content_delta: { type: "content_delta", content: "..." }
/// - done: { type: "done", content: "...", model: "...", provider: "hoosh" }
/// - error: { type: "error", message: "..." }
async fn chat_stream(
    State(_state): State<AppState>,
    Json(body): Json<ChatStreamRequest>,
) -> impl IntoResponse {
    if body.message.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "message is required"})),
        )
            .into_response();
    }

    let base_url = hoosh_base_url();
    let url = format!("{base_url}/v1/chat/completions");

    // Build OpenAI-compatible messages array
    let mut messages = Vec::with_capacity(body.history.len() + 1);
    for msg in &body.history {
        messages.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }
    messages.push(serde_json::json!({
        "role": "user",
        "content": body.message,
    }));

    let model = body.model.as_deref().unwrap_or("default");

    let oai_body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });

    // POST to hoosh
    let client = reqwest::Client::new();
    let response = match client.post(&url).json(&oai_body).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let status = r.status().as_u16();
            let err = r.text().await.unwrap_or_default();
            let event = Event::default().data(
                serde_json::json!({"type": "error", "message": format!("LLM error ({status}): {err}")}).to_string(),
            );
            return Sse::new(tokio_stream::iter(vec![Ok::<_, Infallible>(event)])).into_response();
        }
        Err(e) => {
            let event = Event::default().data(
                serde_json::json!({"type": "error", "message": format!("Failed to connect to LLM: {e}")}).to_string(),
            );
            return Sse::new(tokio_stream::iter(vec![Ok::<_, Infallible>(event)])).into_response();
        }
    };

    // Read the OpenAI SSE response body and map to SY events.
    // OpenAI SSE format: `data: {JSON}\n\n` lines, ending with `data: [DONE]\n\n`.
    let response_text = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            let event = Event::default().data(
                serde_json::json!({"type": "error", "message": format!("Failed to read LLM response: {e}")}).to_string(),
            );
            return Sse::new(tokio_stream::iter(vec![Ok::<_, Infallible>(event)])).into_response();
        }
    };

    // Parse OpenAI SSE lines and accumulate content
    let mut full_content = String::new();
    let mut events: Vec<Result<Event, Infallible>> = Vec::new();
    let mut response_model = model.to_string();

    for line in response_text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(':') {
            continue; // Skip empty lines and comments
        }
        if let Some(data) = line.strip_prefix("data: ") {
            if data == "[DONE]" {
                break;
            }
            if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(data) {
                // Extract model from first chunk
                if let Some(m) = chunk.get("model").and_then(|v| v.as_str()) {
                    response_model = m.to_string();
                }
                // Extract content delta from choices[0].delta.content
                if let Some(content) = chunk
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|c| c.as_str())
                    .filter(|c| !c.is_empty())
                {
                    full_content.push_str(content);
                    events.push(Ok(Event::default().data(
                        serde_json::json!({"type": "content_delta", "content": content})
                            .to_string(),
                    )));
                }
            }
        }
    }

    // Final done event
    events.push(Ok(Event::default().data(
        serde_json::json!({
            "type": "done",
            "content": full_content,
            "model": response_model,
            "provider": "hoosh",
        })
        .to_string(),
    )));

    Sse::new(tokio_stream::iter(events))
        .keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(15)))
        .into_response()
}
