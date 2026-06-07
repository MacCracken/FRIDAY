//! Body size limit middleware — enforces per-route Content-Length limits.
//!
//! Tiers:
//! - auth: 16 KB (login, register, token endpoints)
//! - chat: 512 KB (chat and streaming endpoints)
//! - upload: 10 MB (multipart/form-data requests)
//! - default: 1 MB (everything else)
//!
//! Returns 413 Payload Too Large when Content-Length exceeds the tier limit.
//! Requests without Content-Length are allowed through (matches TS behavior).

use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

use axum::body::Body;
use axum::http::{Request, Response, StatusCode};
use axum::response::IntoResponse;
use serde_json::json;
use tower::{Layer, Service};

const KB: usize = 1024;
const MB: usize = 1024 * 1024;

const AUTH_LIMIT: usize = 16 * KB;
const CHAT_LIMIT: usize = 512 * KB;
const UPLOAD_LIMIT: usize = 10 * MB;
const DEFAULT_LIMIT: usize = MB;

#[derive(Clone)]
pub struct BodyLimitLayer;

impl<S> Layer<S> for BodyLimitLayer {
    type Service = BodyLimitMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        BodyLimitMiddleware { inner }
    }
}

#[derive(Clone)]
pub struct BodyLimitMiddleware<S> {
    inner: S,
}

impl<S, ResBody> Service<Request<Body>> for BodyLimitMiddleware<S>
where
    S: Service<Request<Body>, Response = Response<ResBody>> + Clone + Send + 'static,
    S::Future: Send + 'static,
    ResBody: axum::body::HttpBody<Data = axum::body::Bytes> + Send + 'static,
    ResBody::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    type Response = Response<Body>;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<Body>) -> Self::Future {
        let content_length = req
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<usize>().ok());

        let path = req.uri().path().to_string();
        let content_type = req
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let limit = resolve_limit(&path, content_type.as_deref());

        // Fast path: a declared Content-Length over the limit is rejected outright.
        if let Some(len) = content_length
            && len > limit
        {
            return Box::pin(async move { Ok(too_large(limit, Some(len))) });
        }

        let mut inner = self.inner.clone();

        // When Content-Length is present and within the limit we trust it (hyper
        // bounds the body to that length) and pass the body through as a stream.
        if content_length.is_some() {
            return Box::pin(async move {
                let resp = inner.call(req).await?;
                let (parts, body) = resp.into_parts();
                Ok(Response::from_parts(parts, Body::new(body)))
            });
        }

        // No Content-Length (chunked / streamed): the header check is bypassable,
        // so enforce the cap on the ACTUAL bytes. `to_bytes` aborts the read once
        // `limit` is exceeded, preventing an unbounded-body memory-exhaustion DoS.
        Box::pin(async move {
            let (parts, body) = req.into_parts();
            let bytes = match axum::body::to_bytes(body, limit).await {
                Ok(b) => b,
                Err(_) => return Ok(too_large(limit, None)),
            };
            let req = Request::from_parts(parts, Body::from(bytes));
            let resp = inner.call(req).await?;
            let (rparts, rbody) = resp.into_parts();
            Ok(Response::from_parts(rparts, Body::new(rbody)))
        })
    }
}

/// Build a 413 Payload Too Large JSON response.
fn too_large(limit: usize, received: Option<usize>) -> Response<Body> {
    (
        StatusCode::PAYLOAD_TOO_LARGE,
        axum::Json(json!({
            "error": "Payload too large",
            "statusCode": 413,
            "maxBytes": limit,
            "receivedBytes": received,
        })),
    )
        .into_response()
}

/// Determine the body size limit for a given path and content type.
fn resolve_limit(path: &str, content_type: Option<&str>) -> usize {
    // Multipart uploads get the highest limit
    if content_type.is_some_and(|ct| ct.contains("multipart")) {
        return UPLOAD_LIMIT;
    }

    // Auth endpoints: small payloads only
    if path.starts_with("/api/v1/auth/") {
        return AUTH_LIMIT;
    }

    // Chat endpoints: moderate payloads (messages can be long)
    if path.starts_with("/api/v1/chat") || path.starts_with("/api/v1/inline-complete") {
        return CHAT_LIMIT;
    }

    DEFAULT_LIMIT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_routes_get_16kb_limit() {
        assert_eq!(resolve_limit("/api/v1/auth/login", None), 16 * KB);
        assert_eq!(resolve_limit("/api/v1/auth/register", None), 16 * KB);
    }

    #[test]
    fn chat_routes_get_512kb_limit() {
        assert_eq!(resolve_limit("/api/v1/chat", None), 512 * KB);
        assert_eq!(resolve_limit("/api/v1/chat/stream", None), 512 * KB);
    }

    #[test]
    fn multipart_gets_10mb_limit() {
        assert_eq!(
            resolve_limit(
                "/api/v1/soul/personalities/abc/avatar",
                Some("multipart/form-data; boundary=----")
            ),
            10 * MB
        );
    }

    #[test]
    fn default_routes_get_1mb_limit() {
        assert_eq!(resolve_limit("/api/v1/brain/memories", None), MB);
        assert_eq!(resolve_limit("/api/v1/workflows", None), MB);
    }

    #[test]
    fn inline_complete_gets_chat_limit() {
        assert_eq!(
            resolve_limit("/api/v1/inline-complete/suggest", None),
            512 * KB
        );
    }
}
