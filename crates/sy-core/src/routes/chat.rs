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
        .route(
            "/api/v1/conversations/{id}/title",
            post(update_conversation_title),
        )
        .route("/api/v1/chat/stream", post(chat_stream))
        .route("/api/v1/chat", post(chat_complete))
        .route("/api/v1/chat/feedback", post(chat_feedback))
        .route("/api/v1/chat/remember", post(chat_remember))
        .route("/api/v1/chat/export", post(export_conversation))
        .route("/api/v1/chat/branch", post(branch_conversation))
}

#[derive(Deserialize)]
struct PaginationQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
    #[serde(rename = "personalityId")]
    personality_id: Option<String>,
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
        Ok(rows) => {
            let total = rows.len();
            Json(serde_json::json!({"conversations": rows, "total": total})).into_response()
        }
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
        Ok(Some(row)) => {
            // Include messages in the response
            let messages = chat::list_messages(pool, &id, 200, 0)
                .await
                .unwrap_or_default();
            let mut val = serde_json::to_value(&row).unwrap();
            val["messages"] = serde_json::to_value(&messages).unwrap();
            Json(val).into_response()
        }
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
    State(state): State<AppState>,
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

    // Load personality system prompt if personality_id is provided
    let pid = body.personality_id.clone();
    let system_prompt = if let (Some(pool), Some(pid)) = (state.db(), pid.as_deref()) {
        match crate::db::soul::get_personality(pool, &pid, "default").await {
            Ok(Some(p)) => {
                // Build a system prompt from personality data
                let mut prompt = p.system_prompt.clone();
                if !p.description.is_empty() {
                    prompt = format!("You are {}. {}\n\n{}", p.name, p.description, prompt);
                }
                // Inject trait disposition if traits are set
                if let Some(traits_obj) = p.traits.as_object() {
                    if !traits_obj.is_empty() {
                        let trait_lines: Vec<String> = traits_obj
                            .iter()
                            .map(|(k, v)| format!("- {}: {}", k, v.as_str().unwrap_or("balanced")))
                            .collect();
                        prompt.push_str("\n\n## Personality Traits\n");
                        prompt.push_str(&trait_lines.join("\n"));
                    }
                }
                Some(prompt)
            }
            _ => None,
        }
    } else {
        None
    };

    // Build OpenAI-compatible messages array
    let mut messages = Vec::with_capacity(body.history.len() + 2);

    // Prepend system prompt from personality
    if let Some(ref sp) = system_prompt {
        messages.push(serde_json::json!({
            "role": "system",
            "content": sp,
        }));
    }

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

    // Detect available providers first
    let anthropic_key = std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .filter(|k| !k.is_empty());
    let openai_key = std::env::var("OPENAI_API_KEY")
        .ok()
        .filter(|k| !k.is_empty());

    let has_anthropic = anthropic_key.is_some();
    let has_openai = openai_key.is_some();

    // Default model based on available provider
    let default_model = if has_anthropic { "claude-sonnet-4-6" } else if has_openai { "gpt-4o" } else { "default" };
    let model = body.model.as_deref().unwrap_or(default_model);

    let is_anthropic = model.contains("claude")
        || model.contains("anthropic")
        || (has_anthropic && !has_openai);

    let client = reqwest::Client::new();
    let response = if is_anthropic {
        let key = match &anthropic_key {
            Some(k) => k,
            None => {
                let event = Event::default().data(
                    serde_json::json!({"type": "error", "message": "ANTHROPIC_API_KEY not configured"}).to_string(),
                );
                return Sse::new(tokio_stream::iter(vec![Ok::<_, Infallible>(event)])).into_response();
            }
        };
        // Anthropic: extract system messages into top-level `system` param
        let (system_msgs, user_msgs): (Vec<_>, Vec<_>) = messages
            .iter()
            .partition(|m| m.get("role").and_then(|r| r.as_str()) == Some("system"));
        let system_text = system_msgs
            .iter()
            .filter_map(|m| m.get("content").and_then(|c| c.as_str()))
            .collect::<Vec<_>>()
            .join("\n\n");

        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": 4096,
            "messages": user_msgs,
            "stream": true,
        });
        if !system_text.is_empty() {
            body["system"] = serde_json::Value::String(system_text);
        }

        client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
    } else if let Some(ref key) = openai_key {
        client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(key)
            .json(&serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true,
            }))
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
    } else {
        client
            .post(&format!("{base_url}/v1/chat/completions"))
            .json(&serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true,
            }))
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
    };

    let response = match response {
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

    // Parse SSE lines and accumulate content
    let mut full_content = String::new();
    let mut events: Vec<Result<Event, Infallible>> = Vec::new();
    let mut response_model = model.to_string();
    let mut tokens_used: u64 = 0;

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
                // Extract usage from OpenAI final chunk or Anthropic events
                if let Some(usage) = chunk.get("usage") {
                    if let Some(total) = usage.get("total_tokens").and_then(|t| t.as_u64()) {
                        tokens_used = total;
                    }
                    // Anthropic: input_tokens + output_tokens
                    let input = usage.get("input_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                    let output = usage.get("output_tokens").and_then(|t| t.as_u64()).unwrap_or(0);
                    if input + output > tokens_used {
                        tokens_used = input + output;
                    }
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

    // If no content from OpenAI format, try Anthropic format
    // Anthropic SSE: `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}`
    if full_content.is_empty() {
        for line in response_text.lines() {
            let line = line.trim();
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(data) {
                    // Anthropic content_block_delta
                    if let Some(text) = chunk
                        .get("delta")
                        .and_then(|d| d.get("text"))
                        .and_then(|t| t.as_str())
                        .filter(|t| !t.is_empty())
                    {
                        full_content.push_str(text);
                        events.push(Ok(Event::default().data(
                            serde_json::json!({"type": "content_delta", "content": text})
                                .to_string(),
                        )));
                    }
                    // Anthropic message_start — extract model
                    if let Some(m) = chunk
                        .get("message")
                        .and_then(|msg| msg.get("model"))
                        .and_then(|m| m.as_str())
                    {
                        response_model = m.to_string();
                    }
                }
            }
        }
    }

    let provider_name = if is_anthropic { "anthropic" } else if has_openai { "openai" } else { "hoosh" };

    // Persist messages to DB if we have a conversation
    // (Dashboard creates the conversation before sending the stream request)
    if let Some(pool) = state.db() {
        let conv_id = match body.conversation_id {
            Some(ref cid) if !cid.is_empty() => cid.clone(),
            _ => {
                // No conversation ID — skip persistence (dashboard will retry with one)
                String::new()
            }
        };
        if conv_id.is_empty() {
            // Skip message persistence — no conversation to attach to
        } else {

        // Save user message
        let user_msg_id = uuid::Uuid::now_v7().to_string();
        let _ = chat::insert_message(
            pool, &user_msg_id, &conv_id, "user", &body.message,
            Some(model), Some(provider_name), None,
        ).await;

        // Save assistant message
        if !full_content.is_empty() {
            let asst_msg_id = uuid::Uuid::now_v7().to_string();
            let _ = chat::insert_message(
                pool, &asst_msg_id, &conv_id, "assistant", &full_content,
                Some(&response_model), Some(provider_name), Some(tokens_used as i32),
            ).await;
        }
        } // end else (conv_id not empty)
    }

    // Final done event with all fields the dashboard expects
    events.push(Ok(Event::default().data(
        serde_json::json!({
            "type": "done",
            "content": full_content,
            "model": response_model,
            "provider": provider_name,
            "tokensUsed": tokens_used,
            "creationEvents": [],
        })
        .to_string(),
    )));

    Sse::new(tokio_stream::iter(events))
        .keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(15)))
        .into_response()
}

// ── Non-streaming Chat ──────────────────────────────────────────────────

/// POST /api/v1/chat — non-streaming chat completion.
///
/// Proxies to hoosh's /v1/chat/completions with stream:false and returns the
/// full response body.
async fn chat_complete(
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

    let anthropic_avail = std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.is_empty()).is_some();
    let openai_avail = std::env::var("OPENAI_API_KEY").ok().filter(|k| !k.is_empty()).is_some();
    let def_model = if anthropic_avail { "claude-sonnet-4-6" } else if openai_avail { "gpt-4o" } else { "default" };
    let model = body.model.as_deref().unwrap_or(def_model);

    let oai_body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false,
    });

    let client = reqwest::Client::new();
    match client.post(&url).json(&oai_body).send().await {
        Ok(r) if r.status().is_success() => {
            let oai: serde_json::Value = match r.json().await {
                Ok(v) => v,
                Err(e) => {
                    return (
                        StatusCode::BAD_GATEWAY,
                        Json(serde_json::json!({"error": format!("Failed to parse LLM response: {e}")})),
                    )
                        .into_response();
                }
            };
            let content = oai
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("");
            let response_model = oai.get("model").and_then(|m| m.as_str()).unwrap_or(model);
            Json(serde_json::json!({
                "content": content,
                "model": response_model,
                "provider": "hoosh",
            }))
            .into_response()
        }
        Ok(r) => {
            let status = r.status().as_u16();
            let err = r.text().await.unwrap_or_default();
            (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": format!("LLM error ({status}): {err}")})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": format!("Failed to connect to LLM: {e}")})),
        )
            .into_response(),
    }
}

// ── Chat Feedback ───────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatFeedbackRequest {
    message_id: String,
    rating: String,
    comment: Option<String>,
}

/// POST /api/v1/chat/feedback — submit response feedback.
async fn chat_feedback(
    State(state): State<AppState>,
    Json(body): Json<ChatFeedbackRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match chat::save_feedback(
        pool,
        &body.message_id,
        &body.rating,
        body.comment.as_deref(),
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

// ── Chat Remember ───────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRememberRequest {
    message_id: String,
    label: Option<String>,
}

/// POST /api/v1/chat/remember — save message as memory.
async fn chat_remember(
    State(state): State<AppState>,
    Json(body): Json<ChatRememberRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match chat::save_memory(pool, &body.message_id, body.label.as_deref()).await {
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

// ── Conversation Export ─────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportConversationRequest {
    conversation_id: String,
    personality_id: Option<String>,
    #[serde(default = "default_export_format")]
    format: String,
}

fn default_export_format() -> String {
    "json".to_string()
}

/// POST /api/v1/chat/export — export a conversation with all messages.
async fn export_conversation(
    State(state): State<AppState>,
    Json(body): Json<ExportConversationRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let _ = body.personality_id; // reserved for future filtering
    match chat::export_conversation(pool, &body.conversation_id, "default", &body.format).await {
        Ok(Some(export)) => Json(serde_json::to_value(export).unwrap()).into_response(),
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

// ── Conversation Branch ─────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BranchConversationRequest {
    conversation_id: String,
    /// Zero-based index of the message to branch from.
    fork_message_index: i32,
    #[serde(default = "default_branch_title")]
    title: String,
}

fn default_branch_title() -> String {
    "Branched Conversation".to_string()
}

/// POST /api/v1/chat/branch — create a new conversation branched from an existing one.
async fn branch_conversation(
    State(state): State<AppState>,
    Json(body): Json<BranchConversationRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let new_id = uuid::Uuid::now_v7().to_string();
    match chat::branch_conversation(
        pool,
        &new_id,
        &body.conversation_id,
        body.fork_message_index,
        &body.title,
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

// ── Conversation Title Update ───────────────────────────────────────────

#[derive(Deserialize)]
struct UpdateTitleRequest {
    title: String,
}

/// POST /api/v1/conversations/{id}/title — update conversation title.
async fn update_conversation_title(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateTitleRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match chat::update_conversation_title(pool, &id, "default", &body.title).await {
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
