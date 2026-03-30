//! Reverse proxy — forwards unimplemented routes to the Fastify TS server.
//!
//! During the Phase 7 migration, sy-core runs alongside Fastify. Routes that
//! have been migrated to Rust are handled directly; everything else is proxied
//! to `http://127.0.0.1:{FASTIFY_PORT}`.
//!
//! Once all routes are migrated (Phase 7.7), the proxy is removed entirely.

use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, Response, StatusCode};
use tracing::debug;

use crate::state::AppState;

/// Fallback handler — proxies the request to Fastify.
pub async fn proxy_to_fastify(State(state): State<AppState>, req: Request<Body>) -> Response<Body> {
    let Some(base_url) = state.fastify_url() else {
        // No Fastify fallback configured — return 404
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"error":"Route not implemented in sy-core and no Fastify fallback configured","statusCode":404}"#,
            ))
            .unwrap_or_default();
    };

    let uri = req.uri().clone();
    let method = req.method().clone();
    let target_url = format!("{base_url}{uri}");

    debug!(%method, %uri, "proxying to Fastify");

    // Build the outbound request
    let client = reqwest::Client::new();
    let mut builder = client.request(method.clone(), &target_url);

    // Forward headers (skip host — reqwest sets it)
    for (key, value) in req.headers() {
        if key != "host"
            && let Ok(v) = value.to_str()
        {
            builder = builder.header(key.as_str(), v);
        }
    }

    // Forward body
    let body_bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from(
                    r#"{"error":"Request body too large","statusCode":400}"#,
                ))
                .unwrap_or_default();
        }
    };
    if !body_bytes.is_empty() {
        builder = builder.body(body_bytes.to_vec());
    }

    // Execute
    match builder.send().await {
        Ok(upstream) => {
            let status = upstream.status();
            let mut resp_builder = Response::builder().status(status.as_u16());

            for (key, value) in upstream.headers() {
                resp_builder = resp_builder.header(key.as_str(), value.as_bytes());
            }

            let body = upstream.bytes().await.unwrap_or_default();
            resp_builder.body(Body::from(body)).unwrap_or_default()
        }
        Err(err) => {
            tracing::error!(%err, %target_url, "Fastify proxy failed");
            Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"error":"Fastify proxy failed: {err}","statusCode":502}}"#
                )))
                .unwrap_or_default()
        }
    }
}
