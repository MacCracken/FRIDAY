//! Auth middleware — extracts identity from JWT Bearer token or X-API-Key.
//!
//! Mirrors the TS `auth-middleware.ts` hook chain:
//! 1. Check PUBLIC_ROUTES → skip auth
//! 2. Try Bearer token → validate JWT
//! 3. Try X-API-Key → validate API key hash
//! 4. Fail → 401

use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, Response, StatusCode};
use axum::middleware::Next;
use axum::response::IntoResponse;
use serde_json::json;

use crate::auth::jwt::validate_token;
use crate::auth::permissions::{check_permission, check_permission_strings, resolve_permission};
use crate::state::AppState;

/// Routes that bypass authentication entirely.
const PUBLIC_ROUTES: &[&str] = &[
    "/health",
    "/health/live",
    "/health/ready",
    "/health/deep",
    "/metrics",
    "/prom/metrics",
    "/api/v1/auth/login",
    "/api/v1/auth/oauth/config",
    "/api/v1/auth/oauth/claim",
    "/api/v1/auth/sso/exchange", // OIDC login completion (pre-auth)
    "/api/v1/federation/knowledge/search",
    "/api/v1/federation/marketplace",
    "/api/v1/internal/mcp-bootstrap",
];

/// Prefixes that bypass auth (dynamic paths like /oauth/:provider).
const PUBLIC_PREFIXES: &[&str] = &[
    "/api/v1/auth/oauth/",
    "/api/v1/auth/sso/authorize/", // OIDC login initiation (pre-auth)
    "/api/v1/auth/sso/callback/",
    "/api/v1/auth/sso/saml/",
    "/api/v1/federation/marketplace/",
    "/ws/", // WebSocket auth is handled by the WS handler (token in Sec-WebSocket-Protocol)
];

/// Authenticated user context — injected into request extensions.
#[derive(Debug, Clone)]
pub struct AuthContext {
    pub user_id: String,
    pub role: String,
    pub permissions: Vec<String>,
    pub auth_method: AuthMethod,
    pub jti: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthMethod {
    Jwt,
    ApiKey,
    Certificate,
}

/// Auth middleware — runs as axum middleware via `axum::middleware::from_fn_with_state`.
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Response<Body> {
    let path = req.uri().path();

    // 1. Public routes bypass
    if is_public(path) {
        return next.run(req).await;
    }

    // 2. Avatar GET bypass (personality avatar images)
    if req.method() == "GET" && path.contains("/personalities/") && path.ends_with("/avatar") {
        return next.run(req).await;
    }

    // 3. Try Bearer token
    if let Some(token) = extract_bearer(req.headers()) {
        let jwt_config = state.jwt_config();
        match validate_token(jwt_config, token) {
            Ok(claims) if claims.token_type == "access" => {
                // Check if token has been revoked
                if state.is_token_revoked(&claims.jti).await {
                    return (
                        StatusCode::UNAUTHORIZED,
                        axum::Json(json!({"error": "Token has been revoked", "statusCode": 401})),
                    )
                        .into_response();
                }
                req.extensions_mut().insert(AuthContext {
                    user_id: claims.sub,
                    role: claims.role,
                    permissions: claims.permissions,
                    auth_method: AuthMethod::Jwt,
                    jti: Some(claims.jti),
                });
                return next.run(req).await;
            }
            _ => {}
        }
    }

    // 4. Try API key
    if let Some(api_key) = req.headers().get("x-api-key").and_then(|v| v.to_str().ok())
        && let Some(ctx) = state.validate_api_key(api_key).await
    {
        req.extensions_mut().insert(ctx);
        return next.run(req).await;
    }

    // 5. No valid auth
    (
        StatusCode::UNAUTHORIZED,
        axum::Json(json!({"error": "Missing authentication credentials", "statusCode": 401})),
    )
        .into_response()
}

fn is_public(path: &str) -> bool {
    if PUBLIC_ROUTES.contains(&path) {
        return true;
    }
    PUBLIC_PREFIXES
        .iter()
        .any(|prefix| path.starts_with(prefix))
}

fn extract_bearer(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
}

/// RBAC enforcement middleware — checks permissions after auth.
///
/// Runs after `require_auth`. If no `AuthContext` is present (public route),
/// the request passes through. For authenticated requests, resolves the
/// required permission from method + path and checks it against the user's role.
/// Unmapped routes default to admin-only.
pub async fn enforce_rbac(req: Request<Body>, next: Next) -> Response<Body> {
    // Public routes have no AuthContext — skip RBAC
    let auth = match req.extensions().get::<AuthContext>() {
        Some(ctx) => ctx.clone(),
        None => return next.run(req).await,
    };

    let method = req.method().clone();
    let path = req.uri().path().to_string();

    match resolve_permission(&method, &path) {
        Some(perm) => {
            // 1. The role must grant this resource:action.
            if !check_permission(&auth.role, perm.resource, perm.action) {
                return (
                    StatusCode::FORBIDDEN,
                    axum::Json(json!({
                        "error": "Insufficient permissions",
                        "statusCode": 403,
                        "resource": perm.resource,
                        "action": perm.action,
                        "role": auth.role,
                    })),
                )
                    .into_response();
            }
            // 2. Per-principal least privilege: when the token / API key carries an
            //    explicit permission scope, it must ALSO grant this action (a scope
            //    can restrict below the role, never expand it). An empty scope means
            //    "inherit the role" (backward compatible with unscoped tokens).
            if !auth.permissions.is_empty()
                && !check_permission_strings(&auth.permissions, perm.resource, perm.action)
            {
                return (
                    StatusCode::FORBIDDEN,
                    axum::Json(json!({
                        "error": "Outside token permission scope",
                        "statusCode": 403,
                        "resource": perm.resource,
                        "action": perm.action,
                    })),
                )
                    .into_response();
            }
        }
        None => {
            // Unmapped route: admin only
            if auth.role != "admin" {
                return (
                    StatusCode::FORBIDDEN,
                    axum::Json(json!({
                        "error": "Access denied — unmapped route requires admin",
                        "statusCode": 403,
                    })),
                )
                    .into_response();
            }
        }
    }

    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_routes_detected() {
        assert!(is_public("/health"));
        assert!(is_public("/health/live"));
        assert!(is_public("/api/v1/auth/login"));
        assert!(is_public("/api/v1/auth/oauth/google"));
        assert!(is_public("/api/v1/auth/oauth/google/callback"));
        assert!(!is_public("/api/v1/brain/memories"));
        assert!(!is_public("/api/v1/chat"));
    }

    #[test]
    fn bearer_extraction() {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert("authorization", "Bearer my-token".parse().unwrap());
        assert_eq!(extract_bearer(&headers), Some("my-token"));

        headers.insert("authorization", "Bearer ".parse().unwrap());
        assert_eq!(extract_bearer(&headers), None);

        headers.insert("authorization", "Basic abc".parse().unwrap());
        assert_eq!(extract_bearer(&headers), None);
    }
}
