//! Integration tests for RBAC enforcement middleware.

#[allow(dead_code)]
mod common;

use axum::body::Body;
use axum::http::Request;

// --- Admin: full access ---

#[tokio::test]
async fn admin_can_read_brain() {
    let app = common::test_app();
    let token = common::test_token("admin");
    let (status, _) = common::send(app, common::authed_get("/api/v1/brain/memories", &token)).await;
    assert_ne!(status, 403);
}

#[tokio::test]
async fn admin_can_write_security() {
    let app = common::test_app();
    let token = common::test_token("admin");
    let (status, _) = common::send(
        app,
        common::authed_post("/api/v1/security/policy", &token, "{}"),
    )
    .await;
    assert_ne!(status, 403);
}

#[tokio::test]
async fn admin_can_access_unmapped_route() {
    let app = common::test_app();
    let token = common::test_token("admin");
    let (status, _) = common::send(
        app,
        common::authed_get("/api/v1/totally-unmapped-route", &token),
    )
    .await;
    // Admin should not get 403 on unmapped routes
    assert_ne!(status, 403);
}

// --- Viewer: read-only on specific resources ---

#[tokio::test]
async fn viewer_can_read_brain() {
    let app = common::test_app();
    let token = common::test_token("viewer");
    let (status, _) = common::send(app, common::authed_get("/api/v1/brain/memories", &token)).await;
    assert_ne!(status, 403);
}

#[tokio::test]
async fn viewer_cannot_write_brain() {
    let app = common::test_app();
    let token = common::test_token("viewer");
    let (status, _) = common::send(
        app,
        common::authed_post("/api/v1/brain/memories", &token, "{}"),
    )
    .await;
    assert_eq!(status, 403);
}

#[tokio::test]
async fn viewer_cannot_access_security() {
    let app = common::test_app();
    let token = common::test_token("viewer");
    let (status, _) =
        common::send(app, common::authed_get("/api/v1/security/policy", &token)).await;
    assert_eq!(status, 403);
}

// --- Auditor: read-only on audit/security/telemetry ---

#[tokio::test]
async fn auditor_can_read_audit() {
    let app = common::test_app();
    let token = common::test_token("auditor");
    let (status, _) = common::send(app, common::authed_get("/api/v1/audit/events", &token)).await;
    assert_ne!(status, 403);
}

#[tokio::test]
async fn auditor_cannot_write_audit() {
    let app = common::test_app();
    let token = common::test_token("auditor");
    let (status, _) = common::send(
        app,
        common::authed_post("/api/v1/audit/events", &token, "{}"),
    )
    .await;
    assert_eq!(status, 403);
}

#[tokio::test]
async fn auditor_cannot_read_brain() {
    let app = common::test_app();
    let token = common::test_token("auditor");
    let (status, _) = common::send(app, common::authed_get("/api/v1/brain/memories", &token)).await;
    assert_eq!(status, 403);
}

// --- Operator: broad read/write but no admin routes ---

#[tokio::test]
async fn operator_can_read_and_write_brain() {
    let app = common::test_app();
    let token = common::test_token("operator");
    let (status, _) = common::send(
        app.clone(),
        common::authed_get("/api/v1/brain/memories", &token),
    )
    .await;
    assert_ne!(status, 403, "operator should read brain");

    let (status, _) = common::send(
        app,
        common::authed_post("/api/v1/brain/memories", &token, "{}"),
    )
    .await;
    assert_ne!(status, 403, "operator should write brain");
}

#[tokio::test]
async fn operator_cannot_write_security() {
    let app = common::test_app();
    let token = common::test_token("operator");
    let (status, _) = common::send(
        app,
        common::authed_post("/api/v1/security/policy", &token, "{}"),
    )
    .await;
    assert_eq!(status, 403);
}

// --- Service role: limited scope ---

#[tokio::test]
async fn service_can_read_brain() {
    let app = common::test_app();
    let token = common::test_token("service");
    let (status, _) = common::send(app, common::authed_get("/api/v1/brain/memories", &token)).await;
    assert_ne!(status, 403);
}

#[tokio::test]
async fn service_cannot_write_chat() {
    let app = common::test_app();
    let token = common::test_token("service");
    let (status, _) = common::send(
        app,
        common::authed_post("/api/v1/chat", &token, r#"{"message":"test"}"#),
    )
    .await;
    // Service role doesn't have chat:execute or chat:write
    assert_eq!(status, 403);
}

// --- Unmapped routes ---

#[tokio::test]
async fn non_admin_denied_on_unmapped_route() {
    let app = common::test_app();
    let token = common::test_token("viewer");
    let (status, _) = common::send(
        app,
        common::authed_get("/api/v1/totally-unknown-path", &token),
    )
    .await;
    assert_eq!(status, 403);
}

// --- Public routes bypass RBAC ---

#[tokio::test]
async fn public_route_bypasses_rbac() {
    let app = common::test_app();
    let (status, _) = common::send(app, Request::get("/health").body(Body::empty()).unwrap()).await;
    assert_ne!(status, 403);
    assert_ne!(status, 401);
}

#[tokio::test]
async fn scoped_token_allowed_within_scope() {
    // Admin role + a token scoped to brain:read → brain read is within scope.
    let app = common::test_app();
    let token = common::test_token_scoped("admin", &["brain:read"]);
    let (status, _) = common::send(app, common::authed_get("/api/v1/brain/memories", &token)).await;
    assert_ne!(status, 403, "in-scope request must not be forbidden");
}

#[tokio::test]
async fn scoped_token_denied_outside_scope() {
    // Admin role would allow audit:read, but the token scope is brain:read only —
    // the per-principal scope restricts below the role.
    let app = common::test_app();
    let token = common::test_token_scoped("admin", &["brain:read"]);
    let (status, body) = common::send(app, common::authed_get("/api/v1/audit", &token)).await;
    assert_eq!(status, 403, "out-of-scope request must be forbidden");
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(
        json["error"].as_str().unwrap().contains("scope"),
        "expected a scope error, got {json}"
    );
}

#[tokio::test]
async fn unscoped_token_uses_role_only() {
    // A token with no explicit scope (empty permissions) falls back to role-based
    // checks — backward compatible with existing tokens.
    let app = common::test_app();
    let token = common::test_token("admin");
    let (status, _) = common::send(app, common::authed_get("/api/v1/audit", &token)).await;
    assert_ne!(
        status, 403,
        "unscoped admin token should pass role-based RBAC"
    );
}
