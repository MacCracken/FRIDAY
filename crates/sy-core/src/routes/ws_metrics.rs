//! WebSocket metrics route — real-time metrics broadcast to subscribed clients.
//!
//! GET /ws/metrics — WebSocket upgrade with JWT auth via Sec-WebSocket-Protocol.
//!
//! Protocol:
//!   Client → Server: { "type": "subscribe",   "payload": { "channels": ["metrics", "audit"] } }
//!   Client → Server: { "type": "unsubscribe", "payload": { "channels": ["audit"] } }
//!   Server → Client: { "type": "ack",    "channel": "system", "payload": { "subscribed": [...] } }
//!   Server → Client: { "type": "update", "channel": "metrics", "payload": {...}, "timestamp": N }

use axum::Router;
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::get;
use futures::{SinkExt, StreamExt};
use std::collections::HashSet;
use tokio::sync::broadcast;
use tracing::{debug, warn};

use crate::auth::jwt;
use crate::state::AppState;

/// Channel → required RBAC resource:action.
/// Channels not listed here are open to any authenticated user.
const CHANNEL_PERMISSIONS: &[(&str, &str, &str)] = &[
    ("metrics", "metrics", "read"),
    ("audit", "audit", "read"),
    ("tasks", "tasks", "read"),
    ("security", "security_events", "read"),
    ("proactive", "proactive", "read"),
    ("workflows", "workflows", "read"),
    ("soul", "soul", "read"),
    ("group_chat", "integrations", "read"),
    ("notifications", "notifications", "read"),
    ("video_stream", "capture", "read"),
];

fn channel_permission(channel: &str) -> Option<(&str, &str)> {
    CHANNEL_PERMISSIONS
        .iter()
        .find(|(ch, _, _)| *ch == channel)
        .map(|(_, resource, action)| (*resource, *action))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/ws/metrics", get(ws_metrics_upgrade))
}

/// Extract JWT token from Sec-WebSocket-Protocol header.
/// Format: "token.<jwt>" as one of the subprotocols.
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

/// GET /ws/metrics — WebSocket upgrade handler.
async fn ws_metrics_upgrade(
    State(state): State<AppState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Authenticate via Sec-WebSocket-Protocol header
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

    let claims = match jwt::validate_token(state.jwt_config(), &token) {
        Ok(c) => c,
        Err(_) => {
            return ws
                .on_upgrade(|mut socket| async move {
                    let _ = socket.close().await;
                })
                .into_response();
        }
    };

    let role = claims.role.clone();

    // Subscribe to the metrics broadcast channel
    let rx = state.bridge_subscribe();

    ws.protocols(["token"])
        .on_upgrade(move |socket| handle_ws_client(socket, role, rx))
        .into_response()
}

/// Handle a connected WebSocket client.
async fn handle_ws_client(
    socket: WebSocket,
    role: String,
    mut rx: broadcast::Receiver<crate::state::BridgeEvent>,
) {
    let (mut sender, mut receiver) = socket.split();
    let client_id = uuid::Uuid::now_v7().to_string();
    let mut subscribed_channels: HashSet<String> = HashSet::new();

    debug!(client_id = %client_id, role = %role, "WebSocket client connected");

    loop {
        tokio::select! {
            // Incoming messages from client
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&text) {
                            let msg_type = data.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            let channels: Vec<String> = data
                                .get("payload")
                                .and_then(|p| p.get("channels"))
                                .and_then(|c| serde_json::from_value(c.clone()).ok())
                                .unwrap_or_default();

                            match msg_type {
                                "subscribe" => {
                                    let mut accepted = Vec::new();
                                    for ch in channels.iter().take(50) {
                                        // Check RBAC permission for gated channels
                                        if let Some((_resource, _action)) = channel_permission(ch) {
                                            // For now, all authenticated users can subscribe.
                                            // Full RBAC check will be wired when permissions
                                            // module supports role → resource:action lookup.
                                        }
                                        subscribed_channels.insert(ch.clone());
                                        accepted.push(ch.as_str());
                                    }
                                    let ack = serde_json::json!({
                                        "type": "ack",
                                        "channel": "system",
                                        "payload": { "subscribed": accepted },
                                        "timestamp": now_ms(),
                                        "sequence": 0,
                                    });
                                    let _ = sender.send(Message::Text(ack.to_string().into())).await;
                                }
                                "unsubscribe" => {
                                    let mut removed = Vec::new();
                                    for ch in &channels {
                                        if subscribed_channels.remove(ch) {
                                            removed.push(ch.as_str());
                                        }
                                    }
                                    let ack = serde_json::json!({
                                        "type": "ack",
                                        "channel": "system",
                                        "payload": { "unsubscribed": removed },
                                        "timestamp": now_ms(),
                                        "sequence": 0,
                                    });
                                    let _ = sender.send(Message::Text(ack.to_string().into())).await;
                                }
                                _ => {}
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {} // Ping/Pong handled by axum
                }
            }
            // Broadcast events from server → subscribed clients
            event = rx.recv() => {
                match event {
                    Ok(evt) if subscribed_channels.contains(&evt.event) => {
                        let msg = serde_json::json!({
                            "type": "update",
                            "channel": evt.event,
                            "payload": evt.data,
                            "timestamp": now_ms(),
                            "sequence": now_ms(),
                        });
                        if sender.send(Message::Text(msg.to_string().into())).await.is_err() {
                            break; // Client disconnected
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!(client_id = %client_id, lagged = n, "WebSocket client lagged, skipping events");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                    _ => {} // Event not in subscribed channels
                }
            }
        }
    }

    debug!(client_id = %client_id, "WebSocket client disconnected");
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
