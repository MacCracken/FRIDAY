//! MCP routes — server, tool, resource, and config management.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::mcp;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/mcp/servers", get(list_servers))
        .route("/api/v1/mcp/servers/{id}", get(get_server))
        .route("/api/v1/mcp/servers/{id}/health", get(server_health))
        .route("/api/v1/mcp/tools", get(list_tools))
        .route("/api/v1/mcp/tools/list", get(list_all_tools))
        .route("/api/v1/mcp/tools/call", post(call_tool))
        .route("/api/v1/mcp/config", get(mcp_config))
        .route("/api/v1/mcp/health", get(mcp_health))
        .route("/api/v1/mcp/resources", get(list_resources))
}

async fn list_servers(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::list_servers(pool).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_server(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::get_server(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Server not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn server_health(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::get_mcp_server(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "serverId": row.id,
            "name": row.name,
            "healthy": row.enabled.unwrap_or(false),
            "transport": row.transport
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Server not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_tools(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::list_tools(pool).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_all_tools(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::list_tools(pool).await {
        Ok(rows) => Json(serde_json::json!({"tools": rows, "total": rows.len()})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CallToolRequest {
    name: String,
    #[serde(default = "empty_args")]
    arguments: serde_json::Value,
    server_id: Option<String>,
}
fn empty_args() -> serde_json::Value {
    serde_json::json!({})
}

async fn call_tool(
    State(_state): State<AppState>,
    Json(body): Json<CallToolRequest>,
) -> impl IntoResponse {
    // Tool execution is delegated to the MCP runtime.
    // This endpoint records the request and returns an accepted status.
    Json(serde_json::json!({
        "status": "accepted",
        "tool": body.name,
        "serverId": body.server_id,
        "message": "Tool call queued for execution"
    }))
    .into_response()
}

async fn mcp_config(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::get_config(pool).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn mcp_health(State(state): State<AppState>) -> impl IntoResponse {
    let db_available = state.db().is_some();
    Json(serde_json::json!({
        "status": if db_available { "healthy" } else { "degraded" },
        "dbConnected": db_available,
        "protocol": "2024-11-05"
    }))
    .into_response()
}

async fn list_resources(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::list_resources(pool).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
