//! Integration tests for the health endpoint.

#[allow(dead_code)]
mod common;

use axum::body::Body;
use axum::http::Request;

#[tokio::test]
async fn health_returns_200() {
    let app = common::test_app();
    let (status, _) = common::send(app, Request::get("/health").body(Body::empty()).unwrap()).await;
    assert_eq!(status, 200);
}

#[tokio::test]
async fn health_returns_json_with_status_field() {
    let app = common::test_app();
    let (_, body) = common::send(app, Request::get("/health").body(Body::empty()).unwrap()).await;
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Without DB, status is "degraded" — but the field must exist
    assert!(json.get("status").is_some());
}

#[tokio::test]
async fn health_does_not_require_auth() {
    let app = common::test_app();
    let (status, _) = common::send(app, Request::get("/health").body(Body::empty()).unwrap()).await;
    // Should not be 401 — health is a public route
    assert_ne!(status, 401);
}
