//! Collaborative editing WebSocket — real-time CRDT document sync.
//!
//! GET /ws/collab/{docId} — WebSocket upgrade with JWT auth via Sec-WebSocket-Protocol.
//!
//! docId format: "personality:<uuid>" | "skill:<uuid>"
//!
//! Protocol: binary messages (Uint8Array CRDT operations).
//! Clients in the same room receive each other's binary messages (fan-out).

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::get;
use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, broadcast};
use tracing::{debug, warn};

use crate::auth::jwt;
use crate::state::AppState;

/// Shared collab room state — maps docId → broadcast sender for binary CRDT ops.
type CollabRooms = Arc<RwLock<HashMap<String, broadcast::Sender<Vec<u8>>>>>;

/// Lazy-init shared rooms via AppState extension or a module-level static.
/// Using a static here since AppState doesn't need to know about collab internals.
static ROOMS: std::sync::OnceLock<CollabRooms> = std::sync::OnceLock::new();

fn rooms() -> &'static CollabRooms {
    ROOMS.get_or_init(|| Arc::new(RwLock::new(HashMap::new())))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/ws/collab/{docId}", get(ws_collab_upgrade))
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

/// Validate docId format: "personality:<uuid>" or "skill:<uuid>"
fn is_valid_doc_id(doc_id: &str) -> bool {
    let re_like = |s: &str| -> bool {
        if let Some(id) = s
            .strip_prefix("personality:")
            .or_else(|| s.strip_prefix("skill:"))
        {
            // Simple UUID check: 36 chars, hex + dashes
            id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
        } else {
            false
        }
    };
    re_like(doc_id)
}

async fn ws_collab_upgrade(
    State(state): State<AppState>,
    Path(doc_id): Path<String>,
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

    // Validate docId
    if !is_valid_doc_id(&doc_id) {
        return ws
            .on_upgrade(|mut socket| async move {
                let _ = socket.close().await;
            })
            .into_response();
    }

    ws.protocols(["token"])
        .on_upgrade(move |socket| handle_collab_client(socket, doc_id))
        .into_response()
}

async fn handle_collab_client(socket: WebSocket, doc_id: String) {
    let client_id = uuid::Uuid::now_v7().to_string();
    debug!(client_id = %client_id, doc_id = %doc_id, "Collab client connected");

    // Get or create the room's broadcast channel
    let (tx, mut rx) = {
        let mut rooms = rooms().write().await;
        let tx = rooms
            .entry(doc_id.clone())
            .or_insert_with(|| broadcast::channel(256).0)
            .clone();
        let rx = tx.subscribe();
        (tx, rx)
    };

    let (mut sender, mut receiver) = socket.split();

    loop {
        tokio::select! {
            // Incoming binary CRDT messages from this client → broadcast to room
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        // Broadcast to all other clients in the room
                        let _ = tx.send(data.to_vec());
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
            // Messages from other clients in the room → forward to this client
            event = rx.recv() => {
                match event {
                    Ok(data) => {
                        if sender.send(Message::Binary(data.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!(client_id = %client_id, lagged = n, "Collab client lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    debug!(client_id = %client_id, doc_id = %doc_id, "Collab client disconnected");

    // Clean up empty rooms
    let should_remove = {
        let room_map = rooms().read().await;
        room_map
            .get(&doc_id)
            .is_some_and(|tx| tx.receiver_count() == 0)
    };
    if should_remove {
        rooms().write().await.remove(&doc_id);
    }
}
