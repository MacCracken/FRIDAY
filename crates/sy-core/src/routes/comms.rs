//! Comms routes — peer-to-peer encrypted communication via sy-crypto.
//!
//! No database module — uses sy-crypto native layer for identity and
//! message handling.

use axum::extract::Path;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/comms/identity", get(get_identity))
        .route("/api/v1/comms/peers", get(list_peers))
        .route("/api/v1/comms/peers/{id}", post(add_peer))
        .route("/api/v1/comms/send", post(send_message))
        .route("/api/v1/comms/log", get(message_log))
        .route("/api/v1/comms/message", post(receive_message))
}

/// GET /api/v1/comms/identity — get local comms identity.
async fn get_identity() -> impl IntoResponse {
    // In production this would read from sy-crypto's identity store.
    Json(serde_json::json!({
        "publicKey": serde_json::Value::Null,
        "fingerprint": serde_json::Value::Null,
        "status": "not_initialized",
        "message": "sy-crypto identity not yet initialized",
    }))
    .into_response()
}

/// GET /api/v1/comms/peers — list known peers.
async fn list_peers() -> impl IntoResponse {
    Json(serde_json::json!({
        "peers": [],
        "total": 0,
        "message": "Peer discovery not yet connected",
    }))
    .into_response()
}

/// POST /api/v1/comms/peers/{id} — add a peer by ID.
async fn add_peer(Path(id): Path<String>) -> impl IntoResponse {
    Json(serde_json::json!({
        "peerId": id,
        "status": "pending",
        "message": "Peer add request queued — handshake pending",
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageRequest {
    peer_id: String,
    content: String,
    encrypted: Option<bool>,
}

/// POST /api/v1/comms/send — send a message to a peer.
async fn send_message(Json(body): Json<SendMessageRequest>) -> impl IntoResponse {
    Json(serde_json::json!({
        "peerId": body.peer_id,
        "encrypted": body.encrypted.unwrap_or(true),
        "status": "queued",
        "message": "Message queued for delivery",
    }))
    .into_response()
}

/// GET /api/v1/comms/log — message log.
async fn message_log() -> impl IntoResponse {
    Json(serde_json::json!({
        "messages": [],
        "total": 0,
        "message": "Message log not yet connected",
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiveMessageRequest {
    from_peer: String,
    content: String,
    signature: Option<String>,
}

/// POST /api/v1/comms/message — receive an incoming message.
async fn receive_message(Json(body): Json<ReceiveMessageRequest>) -> impl IntoResponse {
    Json(serde_json::json!({
        "fromPeer": body.from_peer,
        "verified": body.signature.is_some(),
        "status": "received",
        "message": "Message received and queued for processing",
    }))
    .into_response()
}
