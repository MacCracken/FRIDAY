//! Group chat routes — cross-platform channel and message aggregation.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::group_chat;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/group-chat/channels", get(list_channels))
        .route(
            "/api/v1/group-chat/channels/{channelId}/{platform}/messages",
            get(list_messages),
        )
}

#[derive(Deserialize)]
struct ChannelQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    50
}

async fn list_channels(
    State(state): State<AppState>,
    Query(q): Query<ChannelQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match group_chat::list_channels(pool, q.limit.min(200), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct MessageQuery {
    #[serde(default = "default_msg_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_msg_limit() -> i64 {
    100
}

async fn list_messages(
    State(state): State<AppState>,
    Path((channel_id, platform)): Path<(String, String)>,
    Query(q): Query<MessageQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match group_chat::list_messages(pool, &channel_id, &platform, q.limit.min(500), q.offset).await
    {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
