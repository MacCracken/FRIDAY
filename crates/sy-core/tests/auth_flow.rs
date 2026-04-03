//! Integration tests for the authentication flow.

#[allow(dead_code)]
mod common;

use axum::body::Body;
use axum::http::Request;

#[tokio::test]
async fn protected_route_returns_401_without_token() {
    let app = common::test_app();
    let (status, _) = common::send(
        app,
        Request::get("/api/v1/brain/memories")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, 401);
}

#[tokio::test]
async fn protected_route_accepts_valid_token() {
    let app = common::test_app();
    let token = common::test_token("admin");
    let (status, _) = common::send(app, common::authed_get("/api/v1/brain/memories", &token)).await;
    // Should not be 401 — token is valid
    assert_ne!(status, 401);
}

#[tokio::test]
async fn invalid_token_returns_401() {
    let app = common::test_app();
    let (status, _) = common::send(
        app,
        Request::get("/api/v1/brain/memories")
            .header("authorization", "Bearer totally-invalid-token")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, 401);
}

#[tokio::test]
async fn public_route_works_without_token() {
    let app = common::test_app();
    let (status, _) = common::send(
        app,
        Request::get("/api/v1/auth/login")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    // Login endpoint is public — should not be 401
    assert_ne!(status, 401);
}

#[tokio::test]
async fn different_roles_get_valid_tokens() {
    for role in &["admin", "operator", "auditor", "viewer", "service"] {
        let app = common::test_app();
        let token = common::test_token(role);
        let (status, _) =
            common::send(app, common::authed_get("/api/v1/brain/memories", &token)).await;
        // All roles should authenticate successfully (RBAC is a separate phase)
        assert_ne!(status, 401, "role {role} should authenticate");
    }
}
