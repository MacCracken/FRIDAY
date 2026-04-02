//! Integration routes — connected services CRUD, platform/plugin management,
//! inbound message routing, and webhook/transform/outbound-webhook management
//! under the /api/v1/integrations/ namespace.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::integrations;
use crate::db::outbound_webhooks;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // Core CRUD
        .route("/api/v1/integrations", get(list_integrations))
        .route("/api/v1/integrations", post(create_integration))
        .route("/api/v1/integrations/{id}", delete(delete_integration))
        .route("/api/v1/integrations/{id}", get(get_integration))
        .route("/api/v1/integrations/{id}/status", put(update_status))
        // Platforms
        .route("/api/v1/integrations/platforms", get(list_platforms))
        .route(
            "/api/v1/integrations/platforms/{name}/install",
            post(install_platform),
        )
        .route(
            "/api/v1/integrations/platforms/{name}",
            delete(uninstall_platform),
        )
        // Plugins
        .route(
            "/api/v1/integrations/plugins",
            get(list_plugins).post(register_plugin),
        )
        // Inbound message routing
        .route("/api/v1/integrations/message", post(route_message))
        .route(
            "/api/v1/integrations/message/batch",
            post(route_message_batch),
        )
        // Webhooks (inbound) under integrations namespace
        .route(
            "/api/v1/integrations/webhooks",
            get(list_int_webhooks).post(create_int_webhook),
        )
        .route(
            "/api/v1/integrations/webhooks/{id}",
            get(get_int_webhook)
                .put(update_int_webhook)
                .delete(delete_int_webhook),
        )
    // Webhook transforms under integrations namespace are handled by webhook_transforms router
    // Outbound webhooks under integrations namespace are handled by outbound_webhooks router
}

// ---------------------------------------------------------------------------
// Core CRUD
// ---------------------------------------------------------------------------

async fn list_integrations(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match integrations::list_integrations(pool).await {
        Ok(rows) => {
            let total = rows.len();
            let running = rows.iter().filter(|r| r.enabled).count();
            Json(serde_json::json!({"integrations": rows, "total": total, "running": running}))
                .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_integration(
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
    match integrations::get_integration(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Integration not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct UpdateStatusRequest {
    enabled: bool,
    #[serde(default = "default_status")]
    status: String,
}

fn default_status() -> String {
    "connected".to_string()
}

async fn update_status(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateStatusRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match integrations::update_integration_status(pool, &id, body.enabled, &body.status).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Integration not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateIntegrationRequest {
    platform: String,
    display_name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

fn empty_obj() -> serde_json::Value {
    serde_json::json!({})
}

async fn create_integration(
    State(state): State<AppState>,
    Json(body): Json<CreateIntegrationRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match integrations::create_integration(
        pool,
        &id,
        &body.platform,
        &body.display_name,
        &body.config,
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

async fn delete_integration(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match integrations::delete_integration(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Integration not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

/// Known integration platforms served from a static registry.
fn available_platforms() -> serde_json::Value {
    serde_json::json!([
        {"name": "github",    "displayName": "GitHub",          "category": "devtools"},
        {"name": "gitlab",    "displayName": "GitLab",          "category": "devtools"},
        {"name": "jira",      "displayName": "Jira",            "category": "project-management"},
        {"name": "linear",    "displayName": "Linear",          "category": "project-management"},
        {"name": "notion",    "displayName": "Notion",          "category": "knowledge"},
        {"name": "todoist",   "displayName": "Todoist",         "category": "tasks"},
        {"name": "slack",     "displayName": "Slack",           "category": "messaging"},
        {"name": "discord",   "displayName": "Discord",         "category": "messaging"},
        {"name": "gmail",     "displayName": "Gmail",           "category": "email"},
        {"name": "google-calendar", "displayName": "Google Calendar", "category": "calendar"},
        {"name": "twitter",   "displayName": "Twitter/X",       "category": "social"},
        {"name": "todoist",   "displayName": "Todoist",         "category": "tasks"},
    ])
}

async fn list_platforms() -> impl IntoResponse {
    let platforms = available_platforms();
    let total = platforms.as_array().map(|a| a.len()).unwrap_or(0);
    Json(serde_json::json!({
        "platforms": platforms,
        "total": total,
    }))
}

async fn install_platform(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match integrations::create_integration(pool, &id, &name, &name, &empty_obj()).await {
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

async fn uninstall_platform(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    // Delete all integrations for this platform
    match sqlx::query("DELETE FROM integration.integrations WHERE platform = $1")
        .bind(&name)
        .execute(pool)
        .await
    {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

async fn list_plugins(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    // Plugins are integrations with platform prefix "plugin:"
    match sqlx::query_as::<_, integrations::IntegrationRow>(
        "SELECT * FROM integration.integrations WHERE platform LIKE 'plugin:%' ORDER BY display_name ASC",
    )
    .fetch_all(pool)
    .await
    {
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
struct RegisterPluginRequest {
    name: String,
    display_name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn register_plugin(
    State(state): State<AppState>,
    Json(body): Json<RegisterPluginRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    let platform = format!("plugin:{}", body.name);
    match integrations::create_integration(pool, &id, &platform, &body.display_name, &body.config)
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

// ---------------------------------------------------------------------------
// Inbound message routing
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RouteMessageRequest {
    platform: String,
    channel_id: Option<String>,
    sender_id: Option<String>,
    content: String,
    #[serde(default = "empty_obj")]
    metadata: serde_json::Value,
}

async fn route_message(Json(body): Json<RouteMessageRequest>) -> impl IntoResponse {
    let event_id = uuid::Uuid::now_v7().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    Json(serde_json::json!({
        "eventId": event_id,
        "platform": body.platform,
        "channelId": body.channel_id,
        "senderId": body.sender_id,
        "content": body.content,
        "metadata": body.metadata,
        "status": "queued",
        "routedAt": now,
    }))
}

#[derive(Deserialize)]
struct RouteBatchRequest {
    messages: Vec<RouteMessageRequest>,
}

async fn route_message_batch(Json(body): Json<RouteBatchRequest>) -> impl IntoResponse {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let results: Vec<serde_json::Value> = body
        .messages
        .iter()
        .map(|m| {
            serde_json::json!({
                "eventId": uuid::Uuid::now_v7().to_string(),
                "platform": m.platform,
                "status": "queued",
                "routedAt": now,
            })
        })
        .collect();
    let total = results.len();
    Json(serde_json::json!({
        "results": results,
        "total": total,
    }))
}

// ---------------------------------------------------------------------------
// Inbound webhooks (integrations namespace) — stored in outbound_webhooks table
// reused for inbound tracking; in production this would be a separate table.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct WebhookListQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    50
}

async fn list_int_webhooks(
    State(state): State<AppState>,
    Query(q): Query<WebhookListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match outbound_webhooks::list_webhooks(pool, q.limit.min(200), q.offset).await {
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
struct CreateWebhookRequest {
    url: String,
    #[serde(default)]
    events: Vec<String>,
    secret: Option<String>,
    description: Option<String>,
}

async fn create_int_webhook(
    State(state): State<AppState>,
    Json(body): Json<CreateWebhookRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match outbound_webhooks::create_webhook(
        pool,
        &id,
        &body.url,
        &body.events,
        body.secret.as_deref(),
        body.description.as_deref(),
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

async fn get_int_webhook(
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
    match outbound_webhooks::get_webhook(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Webhook not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateWebhookRequest {
    url: Option<String>,
    events: Option<Vec<String>>,
    secret: Option<String>,
    description: Option<String>,
    enabled: Option<bool>,
}

async fn update_int_webhook(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateWebhookRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match outbound_webhooks::update_webhook(
        pool,
        &id,
        body.url.as_deref(),
        body.events.as_deref(),
        body.secret.as_deref(),
        body.description.as_deref(),
        body.enabled,
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Webhook not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_int_webhook(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match outbound_webhooks::delete_webhook(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Webhook not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
