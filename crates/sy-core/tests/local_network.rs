//! Integration tests for local network check middleware.
//!
//! Security note: the client IP is taken from the real socket peer (`ConnectInfo`),
//! NOT from the attacker-controlled `X-Forwarded-For` header — unless the server is
//! explicitly configured to trust a reverse proxy. These tests exercise both modes
//! and the spoofing-resistance guarantee.

#[allow(dead_code)]
mod common;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::Request;
use std::net::SocketAddr;
use sy_core::server::build_router;
use sy_core::state::AppState;

/// Build a test app with local network enforcement enabled (no remote access).
fn restricted_app() -> axum::Router {
    let state =
        AppState::new(sy_core::types::CoreConfig::default()).with_allow_remote_access(false);
    build_router(state)
}

/// Build a test app that trusts `X-Forwarded-For` (simulating a reverse proxy).
fn proxied_app() -> axum::Router {
    let state = AppState::new(sy_core::types::CoreConfig::default())
        .with_allow_remote_access(false)
        .with_trust_proxy_headers(true);
    build_router(state)
}

/// A `GET /health` request whose real socket peer is `peer`.
fn req_from_peer(peer: &str) -> Request<Body> {
    let mut req = Request::get("/health").body(Body::empty()).unwrap();
    let addr: SocketAddr = format!("{peer}:40000").parse().unwrap();
    req.extensions_mut().insert(ConnectInfo(addr));
    req
}

#[tokio::test]
async fn private_peer_is_allowed() {
    let (status, _) = common::send(restricted_app(), req_from_peer("192.168.1.100")).await;
    assert_ne!(
        status, 403,
        "private peer should pass the local-network gate"
    );
}

#[tokio::test]
async fn loopback_peer_is_allowed() {
    let (status, _) = common::send(restricted_app(), req_from_peer("127.0.0.1")).await;
    assert_ne!(status, 403);
}

#[tokio::test]
async fn docker_bridge_peer_is_allowed() {
    let (status, _) = common::send(restricted_app(), req_from_peer("172.17.0.2")).await;
    assert_ne!(status, 403);
}

#[tokio::test]
async fn public_peer_is_rejected() {
    let (status, body) = common::send(restricted_app(), req_from_peer("8.8.8.8")).await;
    assert_eq!(status, 403);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["error"].as_str().unwrap().contains("local network"));
}

/// Regression for the `X-Forwarded-For` spoofing bypass: a public peer must NOT be
/// able to pass the gate by forging `X-Forwarded-For: 127.0.0.1`.
#[tokio::test]
async fn forged_forwarded_for_does_not_bypass_gate() {
    let mut req = req_from_peer("8.8.8.8");
    req.headers_mut()
        .insert("x-forwarded-for", "127.0.0.1".parse().unwrap());
    let (status, _) = common::send(restricted_app(), req).await;
    assert_eq!(
        status, 403,
        "spoofed X-Forwarded-For must be ignored when no proxy is trusted"
    );
}

/// When configured to trust a reverse proxy, the `X-Forwarded-For` client IP is
/// honored (the proxy is responsible for setting it to the real client).
#[tokio::test]
async fn trusted_proxy_honors_forwarded_for() {
    // Public peer (the proxy), but the forwarded client is private → allowed.
    let mut req = req_from_peer("8.8.8.8");
    req.headers_mut()
        .insert("x-forwarded-for", "192.168.1.50".parse().unwrap());
    let (status, _) = common::send(proxied_app(), req).await;
    assert_ne!(
        status, 403,
        "trusted proxy: private forwarded client should pass"
    );

    // A public forwarded client is still rejected even via a trusted proxy.
    let mut req2 = req_from_peer("10.0.0.1");
    req2.headers_mut()
        .insert("x-forwarded-for", "8.8.8.8".parse().unwrap());
    let (status2, _) = common::send(proxied_app(), req2).await;
    assert_eq!(
        status2, 403,
        "trusted proxy: public forwarded client rejected"
    );
}

#[tokio::test]
async fn allow_remote_access_bypasses_check() {
    // test_app has allow_remote_access=true
    let app = common::test_app();
    let (status, _) = common::send(
        app,
        Request::get("/health")
            .header("x-forwarded-for", "8.8.8.8")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    // Should not be 403 — remote access allowed
    assert_ne!(status, 403);
}

#[tokio::test]
async fn no_peer_without_remote_access_is_rejected() {
    // No ConnectInfo and no trusted proxy → "unknown" → not private → 403.
    let (status, _) = common::send(
        restricted_app(),
        Request::get("/health").body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(status, 403);
}
