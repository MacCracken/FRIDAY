//! Integration tests for local network check middleware.

#[allow(dead_code)]
mod common;

use axum::body::Body;
use axum::http::Request;
use sy_core::server::build_router;
use sy_core::state::AppState;

/// Build a test app with local network enforcement enabled.
fn restricted_app() -> axum::Router {
    let state = AppState::new(sy_types::CoreConfig::default()).with_allow_remote_access(false);
    build_router(state)
}

#[tokio::test]
async fn private_ip_via_forwarded_for_is_allowed() {
    let app = restricted_app();
    let (status, _) = common::send(
        app,
        Request::get("/health")
            .header("x-forwarded-for", "192.168.1.100")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_ne!(status, 403, "private IP should be allowed");
}

#[tokio::test]
async fn public_ip_via_forwarded_for_is_rejected() {
    let app = restricted_app();
    let (status, body) = common::send(
        app,
        Request::get("/health")
            .header("x-forwarded-for", "8.8.8.8")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, 403);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["error"].as_str().unwrap().contains("local network"));
}

#[tokio::test]
async fn loopback_is_allowed() {
    let app = restricted_app();
    let (status, _) = common::send(
        app,
        Request::get("/health")
            .header("x-forwarded-for", "127.0.0.1")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_ne!(status, 403);
}

#[tokio::test]
async fn docker_bridge_ip_is_allowed() {
    let app = restricted_app();
    let (status, _) = common::send(
        app,
        Request::get("/health")
            .header("x-forwarded-for", "172.17.0.2")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_ne!(status, 403);
}

#[tokio::test]
async fn allow_remote_access_bypasses_check() {
    // Default test_app has allow_remote_access=true
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
async fn no_ip_header_without_remote_access_is_rejected() {
    let app = restricted_app();
    let (status, _) = common::send(app, Request::get("/health").body(Body::empty()).unwrap()).await;
    // No X-Forwarded-For, no ConnectInfo → "unknown" → not private → 403
    assert_eq!(status, 403);
}
