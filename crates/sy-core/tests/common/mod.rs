//! Shared test helpers for sy-core integration tests.

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

use sy_core::auth::jwt::{JwtConfig, issue_access_token};
use sy_core::server::build_router;
use sy_core::state::AppState;

/// Default JWT secret used in tests (matches CoreConfig::default()).
const TEST_JWT_SECRET: &str = "dev-jwt-secret-change-in-production!!";

/// Build a test AppState with no database and remote access allowed.
pub fn test_state() -> AppState {
    AppState::new(sy_types::CoreConfig::default()).with_allow_remote_access(true)
}

/// Build the full router for integration testing (no database, remote access allowed).
pub fn test_app() -> Router {
    build_router(test_state())
}

/// Build a JwtConfig matching the default AppState secret.
fn test_jwt_config() -> JwtConfig {
    JwtConfig {
        secret: TEST_JWT_SECRET.to_string(),
        ..Default::default()
    }
}

/// Issue a JWT access token for the given role.
pub fn test_token(role: &str) -> String {
    issue_access_token(&test_jwt_config(), "test-user-1", role, &[]).unwrap()
}

/// Issue a JWT access token for a specific user and role.
pub fn test_token_for(user_id: &str, role: &str) -> String {
    issue_access_token(&test_jwt_config(), user_id, role, &[]).unwrap()
}

/// Send a request through the app and return (status, body_bytes).
pub async fn send(app: Router, req: Request<Body>) -> (StatusCode, bytes::Bytes) {
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    (status, body)
}

/// Build a GET request with Bearer auth.
pub fn authed_get(path: &str, token: &str) -> Request<Body> {
    Request::get(path)
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

/// Build a POST request with Bearer auth and JSON body.
pub fn authed_post(path: &str, token: &str, body: &str) -> Request<Body> {
    Request::post(path)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}
