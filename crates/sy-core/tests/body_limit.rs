//! Integration tests for body size limit middleware.

#[allow(dead_code)]
mod common;

use axum::body::Body;
use axum::http::Request;

#[tokio::test]
async fn auth_endpoint_rejects_oversized_body() {
    let app = common::test_app();
    let body = "x".repeat(17 * 1024); // 17KB > 16KB limit
    let (status, _) = common::send(
        app,
        Request::post("/api/v1/auth/login")
            .header("content-length", body.len().to_string())
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(status, 413);
}

#[tokio::test]
async fn auth_endpoint_allows_small_body() {
    let app = common::test_app();
    let body = r#"{"username":"test","password":"test"}"#;
    let (status, _) = common::send(
        app,
        Request::post("/api/v1/auth/login")
            .header("content-length", body.len().to_string())
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    // Should not be 413 — body is well within 16KB
    assert_ne!(status, 413);
}

#[tokio::test]
async fn chat_endpoint_allows_up_to_512kb() {
    let app = common::test_app();
    let token = common::test_token("admin");
    let body = "x".repeat(500 * 1024); // 500KB < 512KB limit
    let (status, _) = common::send(
        app,
        Request::post("/api/v1/chat")
            .header("authorization", format!("Bearer {token}"))
            .header("content-length", body.len().to_string())
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_ne!(status, 413);
}

#[tokio::test]
async fn chat_endpoint_rejects_over_512kb() {
    let app = common::test_app();
    let token = common::test_token("admin");
    let body = "x".repeat(513 * 1024); // 513KB > 512KB limit
    let (status, _) = common::send(
        app,
        Request::post("/api/v1/chat")
            .header("authorization", format!("Bearer {token}"))
            .header("content-length", body.len().to_string())
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(status, 413);
}

#[tokio::test]
async fn default_endpoint_rejects_over_1mb() {
    let app = common::test_app();
    let token = common::test_token("admin");
    let body = "x".repeat(1025 * 1024); // 1025KB > 1MB limit
    let (status, _) = common::send(
        app,
        Request::post("/api/v1/brain/memories")
            .header("authorization", format!("Bearer {token}"))
            .header("content-length", body.len().to_string())
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(status, 413);
}

#[tokio::test]
async fn request_without_content_length_passes_through() {
    let app = common::test_app();
    let (status, _) = common::send(app, Request::get("/health").body(Body::empty()).unwrap()).await;
    // No Content-Length → should not be 413
    assert_ne!(status, 413);
}

#[tokio::test]
async fn payload_too_large_response_includes_details() {
    let app = common::test_app();
    let body = "x".repeat(17 * 1024);
    let (status, resp_body) = common::send(
        app,
        Request::post("/api/v1/auth/login")
            .header("content-length", body.len().to_string())
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap(),
    )
    .await;
    assert_eq!(status, 413);
    let json: serde_json::Value = serde_json::from_slice(&resp_body).unwrap();
    assert_eq!(json["statusCode"], 413);
    assert!(json["maxBytes"].as_u64().unwrap() > 0);
}
