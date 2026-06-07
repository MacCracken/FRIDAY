//! Integration tests for the OIDC SSO endpoints (wiring + fail-safe behavior).
//! End-to-end token exchange requires a live IdP and is covered manually.

#[allow(dead_code)]
mod common;

use axum::body::Body;
use axum::http::Request;

#[tokio::test]
async fn sso_exchange_is_public_and_fails_safe_when_unconfigured() {
    // No OIDC env / no DB in the test app. The endpoint must be reachable without
    // auth (it's a login completion), and must NOT mint a token or fall back to a
    // stub when OIDC is unconfigured.
    let app = common::test_app();
    let req = Request::post("/api/v1/auth/sso/exchange")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"providerId":"default","code":"abc","state":"xyz"}"#,
        ))
        .unwrap();
    let (status, body) = common::send(app, req).await;

    assert_ne!(
        status, 401,
        "exchange must be reachable pre-auth (public route)"
    );
    let json: serde_json::Value =
        serde_json::from_slice(&body).unwrap_or_else(|_| serde_json::json!({}));
    assert!(
        json.get("accessToken").is_none(),
        "must not mint a token when OIDC is unconfigured"
    );
    assert!(
        json.get("stub").is_none(),
        "the failed-closed stub path must be gone"
    );
}

#[tokio::test]
async fn sso_authorize_is_public() {
    let app = common::test_app();
    let req = Request::get("/api/v1/auth/sso/authorize/default")
        .body(Body::empty())
        .unwrap();
    let (status, _) = common::send(app, req).await;
    assert_ne!(
        status, 401,
        "authorize must be reachable pre-auth (public route)"
    );
}

#[tokio::test]
async fn sso_providers_crud_still_requires_auth() {
    // The provider-management endpoints stay behind auth (only the login
    // initiation/completion are public).
    let app = common::test_app();
    let req = Request::get("/api/v1/auth/sso/providers")
        .body(Body::empty())
        .unwrap();
    let (status, _) = common::send(app, req).await;
    assert_eq!(status, 401, "provider CRUD must require authentication");
}
