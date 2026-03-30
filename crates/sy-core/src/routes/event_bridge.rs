//! Event Bridge — bidirectional SSE channel for ecosystem event streaming.
//!
//! - GET  /api/v1/events/bridge/stream  — long-lived SSE, receives broadcast events
//! - POST /api/v1/events/bridge/publish — broadcast an event to all connected clients
//! - GET  /api/v1/events/bridge/status  — bridge status (connected clients)

use axum::extract::{Query, State};
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::stream::Stream;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;

use crate::state::{AppState, BridgeEvent};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/events/bridge/stream", get(bridge_stream))
        .route("/api/v1/events/bridge/publish", post(bridge_publish))
        .route("/api/v1/events/bridge/status", get(bridge_status))
}

#[derive(Deserialize)]
struct StreamQuery {
    source: Option<String>,
}

/// GET /api/v1/events/bridge/stream — long-lived SSE connection.
///
/// Clients subscribe to the broadcast channel and receive events as SSE data frames.
/// On connection, sends an initial `connected` event with a client ID.
async fn bridge_stream(
    State(state): State<AppState>,
    Query(q): Query<StreamQuery>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let source = q.source.unwrap_or_else(|| "unknown".to_string());
    let client_id = uuid::Uuid::now_v7().to_string();
    let rx = state.bridge_subscribe();

    // Initial connected event + broadcast stream
    let connected = Event::default()
        .event("connected")
        .data(serde_json::json!({"clientId": client_id, "source": source}).to_string());

    let broadcast = BroadcastStream::new(rx).filter_map(|result| {
        match result {
            Ok(evt) => {
                let payload = serde_json::json!({
                    "event": evt.event,
                    "data": evt.data,
                    "source": evt.source,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                });
                Some(Ok(Event::default()
                    .event(evt.event)
                    .data(payload.to_string())))
            }
            Err(_) => None, // Lagged — skip missed events
        }
    });

    let stream =
        futures::stream::once(async move { Ok::<_, Infallible>(connected) }).chain(broadcast);

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keepalive"),
    )
}

#[derive(Deserialize)]
struct PublishBody {
    event: String,
    data: serde_json::Value,
    source: Option<String>,
}

/// POST /api/v1/events/bridge/publish — broadcast an event to all connected SSE clients.
async fn bridge_publish(
    State(state): State<AppState>,
    Json(body): Json<PublishBody>,
) -> impl IntoResponse {
    let sent = state.bridge_broadcast(BridgeEvent {
        event: body.event,
        data: body.data.to_string(),
        source: body.source.unwrap_or_else(|| "secureyeoman".to_string()),
    });

    Json(serde_json::json!({ "sent": sent }))
}

/// GET /api/v1/events/bridge/status — bridge status.
async fn bridge_status(State(state): State<AppState>) -> impl IntoResponse {
    let subscriber_count = state.bridge_subscribe().len();
    Json(serde_json::json!({
        "outbound": {
            "subscriberCount": subscriber_count,
        },
    }))
}
