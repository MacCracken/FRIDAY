//! Integration tests for backpressure middleware.

#[allow(dead_code)]
mod common;

use axum::body::Body;
use axum::http::Request;
use sy_core::middleware::backpressure::{LEVEL_CRITICAL, LEVEL_ELEVATED, LEVEL_NORMAL};
use sy_core::server::build_router;
use sy_core::state::AppState;

fn backpressure_app() -> (axum::Router, AppState) {
    let state = AppState::new(sy_types::CoreConfig::default()).with_allow_remote_access(true);
    let app = build_router(state.clone());
    (app, state)
}

#[tokio::test]
async fn normal_level_allows_all_requests() {
    let (app, _state) = backpressure_app();
    let token = common::test_token("admin");

    // Low-priority route should pass at normal level
    let (status, _) =
        common::send(app, common::authed_get("/api/v1/analytics/summary", &token)).await;
    assert_ne!(status, 503);
}

#[tokio::test]
async fn elevated_level_rejects_low_priority() {
    let (app, state) = backpressure_app();
    state.backpressure().set_level(LEVEL_ELEVATED);

    let token = common::test_token("admin");
    let (status, _) =
        common::send(app, common::authed_get("/api/v1/analytics/summary", &token)).await;
    assert_eq!(status, 503);
}

#[tokio::test]
async fn elevated_level_allows_normal_priority() {
    let (app, state) = backpressure_app();
    state.backpressure().set_level(LEVEL_ELEVATED);

    let token = common::test_token("admin");
    let (status, body) =
        common::send(app, common::authed_get("/api/v1/brain/memories", &token)).await;
    // Route may return 503 due to no DB, but the body should NOT contain backpressure message
    if status == 503 {
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
        assert_ne!(
            json["error"].as_str().unwrap_or(""),
            "Service under pressure — try again later",
            "should not be backpressure rejection for normal-priority at elevated"
        );
    }
}

#[tokio::test]
async fn critical_level_rejects_normal_priority() {
    let (app, state) = backpressure_app();
    state.backpressure().set_level(LEVEL_CRITICAL);

    let token = common::test_token("admin");
    let (status, body) =
        common::send(app, common::authed_get("/api/v1/brain/memories", &token)).await;
    assert_eq!(status, 503);
    // Verify it's a backpressure rejection, not a DB error
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["error"].as_str().unwrap(),
        "Service under pressure — try again later"
    );
}

#[tokio::test]
async fn critical_level_allows_health() {
    let (app, state) = backpressure_app();
    state.backpressure().set_level(LEVEL_CRITICAL);

    let (status, _) = common::send(app, Request::get("/health").body(Body::empty()).unwrap()).await;
    assert_ne!(status, 503);
}

#[tokio::test]
async fn critical_level_allows_auth() {
    let (app, state) = backpressure_app();
    state.backpressure().set_level(LEVEL_CRITICAL);

    let (status, _) = common::send(
        app,
        Request::post("/api/v1/auth/login")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"username":"test","password":"test"}"#))
            .unwrap(),
    )
    .await;
    assert_ne!(status, 503);
}

#[tokio::test]
async fn back_to_normal_allows_all() {
    let (app, state) = backpressure_app();
    state.backpressure().set_level(LEVEL_CRITICAL);
    state.backpressure().set_level(LEVEL_NORMAL);

    let token = common::test_token("admin");
    let (status, _) =
        common::send(app, common::authed_get("/api/v1/analytics/summary", &token)).await;
    assert_ne!(status, 503);
}

#[tokio::test]
async fn retry_after_header_present_on_503() {
    let (app, state) = backpressure_app();
    state.backpressure().set_level(LEVEL_CRITICAL);

    let token = common::test_token("admin");
    use tower::ServiceExt;
    let resp = app
        .oneshot(common::authed_get("/api/v1/brain/memories", &token))
        .await
        .unwrap();
    assert_eq!(resp.status(), 503);
    assert_eq!(
        resp.headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok()),
        Some("30")
    );
}
