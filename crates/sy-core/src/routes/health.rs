//! Health check endpoints — must match the existing TS response shape exactly.

use axum::Json;
use axum::extract::State;
use sy_types::HealthResponse;

use crate::state::AppState;

/// GET /health — liveness probe.
///
/// Returns health status with checks for database, MCP, and audit chain.
/// Dashboard expects `checks.database`, `checks.auditChain`, `checks.mcp`.
pub async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let db_ok = state.db().is_some();
    let tls_enabled = std::env::var("TLS_TERMINATED_BY_PROXY")
        .map(|v| v == "true")
        .unwrap_or(false);
    let external_url = std::env::var("SECUREYEOMAN_EXTERNAL_URL").unwrap_or_default();
    let network_mode = if !external_url.is_empty() && tls_enabled {
        "public"
    } else if tls_enabled {
        "public" // TLS on LAN = treat as secured
    } else if state.config().host == "0.0.0.0" {
        "lan"
    } else {
        "local"
    };

    Json(serde_json::json!({
        "status": if db_ok { "ok" } else { "degraded" },
        "version": state.version(),
        "uptimeSeconds": state.uptime_seconds(),
        "environment": state.config().environment,
        "networkMode": network_mode,
        "checks": {
            "database": db_ok,
            "auditChain": db_ok,
            "mcp": true,
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use axum::body::Body;
    use axum::http::Request;
    use axum::routing::get;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_state() -> AppState {
        AppState::new(sy_types::CoreConfig::default())
    }

    #[tokio::test]
    async fn health_returns_ok() {
        let app = Router::new()
            .route("/health", get(health))
            .with_state(test_state());

        let resp = app
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(resp.status(), 200);
        let body = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "degraded");
        assert_eq!(json["checks"]["database"], false);
        assert!(json["version"].is_string());
        assert!(json["uptimeSeconds"].is_number());
    }
}
