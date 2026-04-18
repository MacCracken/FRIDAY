//! Server router — builds the axum Router with the 13-layer middleware stack
//! and all route modules.

use axum::Router;
use axum::http::{HeaderName, HeaderValue, Method as HttpMethod, StatusCode};
use axum::middleware as axum_mw;
use axum::response::IntoResponse;
use axum::routing::get;

use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::auth::middleware::{enforce_rbac, require_auth};
use crate::middleware::backpressure::check_backpressure;
use crate::middleware::body_limit::BodyLimitLayer;
use crate::middleware::correlation_id::CorrelationIdLayer;
use crate::middleware::fingerprinting::check_fingerprint;
use crate::middleware::ip_reputation::{IpReputationLayer, IpReputationState};
use crate::middleware::local_network::check_local_network;
use crate::middleware::rate_limit::{RateLimitLayer, RateLimitState};
use crate::middleware::security_headers::SecurityHeadersLayer;
use crate::routes::health;
use crate::state::AppState;

/// Build the CORS layer from environment config.
///
/// Reads `SECUREYEOMAN_CORS_ORIGINS` (comma-separated). Defaults to `http://localhost:5173`.
fn build_cors_layer() -> CorsLayer {
    let origins_raw = std::env::var("SECUREYEOMAN_CORS_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:5173".to_string());

    let origins: Vec<HeaderValue> = origins_raw
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter_map(|s| HeaderValue::from_str(s).ok())
        .collect();

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            HttpMethod::GET,
            HttpMethod::POST,
            HttpMethod::PUT,
            HttpMethod::PATCH,
            HttpMethod::DELETE,
            HttpMethod::OPTIONS,
        ])
        .allow_headers([
            HeaderName::from_static("authorization"),
            HeaderName::from_static("content-type"),
            HeaderName::from_static("x-api-key"),
            HeaderName::from_static("x-correlation-id"),
        ])
        .allow_credentials(true)
}

/// Fallback handler for unmatched routes. Returns a 404 JSON error.
async fn not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        [("content-type", "application/json")],
        r#"{"error":"Not Found","statusCode":404}"#,
    )
}

/// Build the full axum router with middleware stack.
pub fn build_router(state: AppState) -> Router {
    // Routes implemented in Rust
    let api = Router::new()
        .route("/health", get(health::health))
        .merge(crate::routes::auth::router())
        .merge(crate::routes::brain::router())
        .merge(crate::routes::soul::router())
        .merge(crate::routes::chat::router())
        .merge(crate::routes::agents::router())
        .merge(crate::routes::workflow::router())
        .merge(crate::routes::spirit::router())
        .merge(crate::routes::audit::router())
        .merge(crate::routes::marketplace::router())
        .merge(crate::routes::integrations::router())
        .merge(crate::routes::tasks::router())
        .merge(crate::routes::alerts::router())
        .merge(crate::routes::mcp::router())
        .merge(crate::routes::notifications::router())
        .merge(crate::routes::workspace::router())
        .merge(crate::routes::gateway::router())
        .merge(crate::routes::a2a::router())
        .merge(crate::routes::training::router())
        .merge(crate::routes::edge::router())
        .merge(crate::routes::security::router())
        .merge(crate::routes::analytics::router())
        .merge(crate::routes::risk::router())
        .merge(crate::routes::federation::router())
        .merge(crate::routes::backup::router())
        .merge(crate::routes::tenants::router())
        .merge(crate::routes::execution::router())
        .merge(crate::routes::proactive::router())
        .merge(crate::routes::sandbox::router())
        .merge(crate::routes::extensions::router())
        .merge(crate::routes::experiments::router())
        .merge(crate::routes::event_bridge::router())
        .merge(crate::routes::models::router())
        .merge(crate::routes::ws_metrics::router())
        .merge(crate::routes::ws_collab::router())
        .merge(crate::routes::ws_video::router())
        .merge(crate::routes::todoist::router())
        .merge(crate::routes::jira::router())
        .merge(crate::routes::linear::router())
        .merge(crate::routes::notion::router())
        .merge(crate::routes::photisnadi::router())
        .merge(crate::routes::trading::router())
        .merge(crate::routes::google_calendar::router())
        .merge(crate::routes::gmail::router())
        .merge(crate::routes::github::router())
        .merge(crate::routes::ifran_proxy::router())
        .merge(crate::routes::forge::router())
        .merge(crate::routes::twitter::router())
        .merge(crate::routes::simulation::router())
        .merge(crate::routes::risk_assessment::router())
        .merge(crate::routes::desktop::router())
        .merge(crate::routes::responsible_ai::router())
        .merge(crate::routes::provider_accounts::router())
        .merge(crate::routes::observability::router())
        .merge(crate::routes::intent::router())
        .merge(crate::routes::chaos::router())
        .merge(crate::routes::dashboards::router())
        .merge(crate::routes::group_chat::router())
        .merge(crate::routes::license::router())
        .merge(crate::routes::outbound_webhooks::router())
        .merge(crate::routes::shruti::router())
        .merge(crate::routes::webhook_transforms::router())
        .merge(crate::routes::scim::router())
        .merge(crate::routes::diagnostics::router())
        .merge(crate::routes::replay_jobs::router())
        .merge(crate::routes::routing_rules::router())
        .merge(crate::routes::events::router())
        .merge(crate::routes::personalities::router())
        .merge(crate::routes::users::router())
        .merge(crate::routes::voice::router())
        .merge(crate::routes::browser::router())
        .merge(crate::routes::ecosystem::router())
        .merge(crate::routes::editor::router())
        .merge(crate::routes::terminal::router())
        .merge(crate::routes::video_stream::router())
        .merge(crate::routes::agent_replay::router())
        .merge(crate::routes::autonomy::router())
        .merge(crate::routes::capture::router())
        .merge(crate::routes::comms::router())
        .merge(crate::routes::compliance::router())
        .merge(crate::routes::reports::router())
        .merge(crate::routes::admin_settings::router())
        .merge(crate::routes::ai_batch::router())
        .merge(crate::routes::cicd_timeline::router())
        .merge(crate::routes::integrations_forge::router())
        .merge(crate::routes::eval::router())
        .merge(crate::routes::iac::router())
        .merge(crate::routes::multimodal::router())
        .merge(crate::routes::policy_as_code::router());

    // Unmatched routes → 404 JSON (no legacy proxy fallback).
    let app = api.fallback(not_found);

    // Middleware stack (outermost → innermost execution order):
    // TraceLayer → CompressionLayer → CorsLayer → LocalNetworkCheck → IpReputation →
    // Backpressure → RateLimit → BodyLimit → CorrelationId → Fingerprint →
    // SecurityHeaders → require_auth → enforce_rbac → handler
    app.layer(axum_mw::from_fn(enforce_rbac))
        .layer(axum_mw::from_fn_with_state(state.clone(), require_auth))
        .layer(SecurityHeadersLayer)
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            check_fingerprint,
        ))
        .layer(CorrelationIdLayer)
        .layer(BodyLimitLayer)
        .layer(RateLimitLayer::new(RateLimitState::new()))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            check_backpressure,
        ))
        .layer(IpReputationLayer::new(IpReputationState::default()))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            check_local_network,
        ))
        .layer(build_cors_layer())
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_state() -> AppState {
        AppState::new(crate::types::CoreConfig::default()).with_allow_remote_access(true)
    }

    #[tokio::test]
    async fn health_endpoint_works() {
        let app = build_router(test_state());
        let resp = app
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "degraded");
    }

    #[tokio::test]
    async fn unknown_route_returns_401_without_auth() {
        // Non-public route without auth → 401
        let app = build_router(test_state());
        let resp = app
            .oneshot(
                Request::get("/api/v1/nonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), 401);
    }

    #[tokio::test]
    async fn correlation_id_set_on_response() {
        let app = build_router(test_state());
        let resp = app
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert!(resp.headers().get("x-correlation-id").is_some());
    }

    #[tokio::test]
    async fn cors_allows_configured_origin() {
        // Default origin is http://localhost:5173
        let app = build_router(test_state());
        let resp = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/health")
                    .header("origin", "http://localhost:5173")
                    .header("access-control-request-method", "GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.headers()
                .get("access-control-allow-origin")
                .and_then(|v| v.to_str().ok()),
            Some("http://localhost:5173")
        );
    }

    #[tokio::test]
    async fn cors_rejects_unknown_origin() {
        let app = build_router(test_state());
        let resp = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/health")
                    .header("origin", "http://evil.example.com")
                    .header("access-control-request-method", "GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        // Should not echo back the disallowed origin
        assert!(resp.headers().get("access-control-allow-origin").is_none());
    }

    #[tokio::test]
    async fn cors_allows_credentials() {
        let app = build_router(test_state());
        let resp = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/health")
                    .header("origin", "http://localhost:5173")
                    .header("access-control-request-method", "GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.headers()
                .get("access-control-allow-credentials")
                .and_then(|v| v.to_str().ok()),
            Some("true")
        );
    }

    #[tokio::test]
    async fn security_headers_set() {
        let app = build_router(test_state());
        let resp = app
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            resp.headers().get("x-content-type-options").unwrap(),
            "nosniff"
        );
        assert_eq!(resp.headers().get("x-frame-options").unwrap(), "DENY");
    }
}
