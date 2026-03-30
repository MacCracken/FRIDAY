//! Video streaming WebSocket — real-time video frame relay.
//!
//! GET /ws/video/{sessionId} — WebSocket upgrade with JWT auth via Sec-WebSocket-Protocol.
//!
//! Protocol:
//!   Server → Client: { "type": "session_started", "session": {...} }
//!   Server → Client: { "type": "frame", "frame": <base64|binary> }
//!   Server → Client: { "type": "session_stopped" }
//!
//! Frames are broadcast from the video capture source to all subscribed clients.

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::get;
use futures::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use tracing::debug;

use crate::auth::jwt;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/ws/video/{sessionId}", get(ws_video_upgrade))
}

/// Extract JWT token from Sec-WebSocket-Protocol header.
fn extract_ws_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .and_then(|protocols| {
            protocols
                .split(',')
                .map(|p| p.trim())
                .find(|p| p.starts_with("token."))
                .map(|p| p[6..].to_string())
        })
}

async fn ws_video_upgrade(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Auth
    let token = match extract_ws_token(&headers) {
        Some(t) => t,
        None => {
            return ws
                .on_upgrade(|mut socket| async move {
                    let _ = socket.close().await;
                })
                .into_response();
        }
    };

    if jwt::validate_token(state.jwt_config(), &token).is_err() {
        return ws
            .on_upgrade(|mut socket| async move {
                let _ = socket.close().await;
            })
            .into_response();
    }

    // Video streaming security check — delegated to config flags.
    // During migration, the actual VideoStreamManager lives in TS.
    // This route accepts the WebSocket and relays frames from the
    // bridge broadcast channel (video frames published via event bridge).

    let rx = state.bridge_subscribe();

    ws.protocols(["token"])
        .on_upgrade(move |socket| handle_video_client(socket, session_id, rx))
        .into_response()
}

async fn handle_video_client(
    socket: WebSocket,
    session_id: String,
    mut rx: broadcast::Receiver<crate::state::BridgeEvent>,
) {
    let (mut sender, mut receiver) = socket.split();
    let client_id = uuid::Uuid::now_v7().to_string();

    debug!(client_id = %client_id, session_id = %session_id, "Video stream client connected");

    // Send initial session state
    let init = serde_json::json!({
        "type": "session_started",
        "session": { "id": session_id },
    });
    let _ = sender.send(Message::Text(init.to_string().into())).await;

    // Filter channel prefix for this session's video frames
    let frame_channel = format!("video:{session_id}");

    loop {
        tokio::select! {
            // Client messages (control: close only)
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
            // Video frames from broadcast channel
            event = rx.recv() => {
                match event {
                    Ok(evt) if evt.event == frame_channel => {
                        if sender.send(Message::Text(evt.data.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                    _ => {} // Different channel or lagged
                }
            }
        }
    }

    debug!(client_id = %client_id, session_id = %session_id, "Video stream client disconnected");
}
