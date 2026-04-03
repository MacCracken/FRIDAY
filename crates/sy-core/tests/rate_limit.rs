//! Integration tests for rate limiting middleware.

#[allow(dead_code)]
mod common;

use axum::body::Body;
use axum::http::Request;

#[tokio::test]
async fn auth_endpoint_rate_limited_after_5_requests() {
    let app = common::test_app();
    // Auth tier: 5 req/min
    for i in 0..5 {
        let (status, _) = common::send(
            app.clone(),
            Request::post("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"username":"test","password":"test"}"#))
                .unwrap(),
        )
        .await;
        assert_ne!(status, 429, "request {i} should not be rate limited");
    }
    // 6th request should be rate limited
    let (status, _) = common::send(
        app.clone(),
        Request::post("/api/v1/auth/login")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"username":"test","password":"test"}"#))
            .unwrap(),
    )
    .await;
    assert_eq!(status, 429);
}

#[tokio::test]
async fn rate_limit_returns_retry_after_header() {
    let app = common::test_app();
    // Exhaust auth tier
    for _ in 0..5 {
        common::send(
            app.clone(),
            Request::post("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"username":"test","password":"test"}"#))
                .unwrap(),
        )
        .await;
    }

    use tower::ServiceExt;
    let resp = app
        .clone()
        .oneshot(
            Request::post("/api/v1/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"username":"test","password":"test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), 429);
    assert!(resp.headers().get("retry-after").is_some());
}

#[tokio::test]
async fn general_endpoint_has_higher_limit() {
    let app = common::test_app();
    let token = common::test_token("admin");
    // General tier: 120 req/min — send 10 and verify none are rate limited
    for i in 0..10 {
        let (status, _) = common::send(
            app.clone(),
            common::authed_get("/api/v1/brain/memories", &token),
        )
        .await;
        assert_ne!(
            status, 429,
            "general request {i} should not be rate limited"
        );
    }
}

#[tokio::test]
async fn successful_response_includes_remaining_header() {
    use tower::ServiceExt;

    let app = common::test_app();
    let resp = app
        .oneshot(Request::get("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert!(resp.headers().get("x-ratelimit-remaining").is_some());
}
