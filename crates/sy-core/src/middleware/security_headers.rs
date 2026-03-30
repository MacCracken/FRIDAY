//! Security headers middleware — CSP, HSTS, X-Frame-Options, etc.
//!
//! Mirrors the headers set by the Fastify onRequest hook in server.ts.

use axum::http::{HeaderValue, Request, Response};
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use tower::{Layer, Service};

#[derive(Clone)]
pub struct SecurityHeadersLayer;

impl<S> Layer<S> for SecurityHeadersLayer {
    type Service = SecurityHeadersMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        SecurityHeadersMiddleware { inner }
    }
}

#[derive(Clone)]
pub struct SecurityHeadersMiddleware<S> {
    inner: S,
}

impl<S, ReqBody, ResBody> Service<Request<ReqBody>> for SecurityHeadersMiddleware<S>
where
    S: Service<Request<ReqBody>, Response = Response<ResBody>> + Clone + Send + 'static,
    S::Future: Send + 'static,
    ReqBody: Send + 'static,
    ResBody: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<ReqBody>) -> Self::Future {
        let mut inner = self.inner.clone();
        Box::pin(async move {
            let mut resp = inner.call(req).await?;
            let headers = resp.headers_mut();

            set(headers, "x-content-type-options", "nosniff");
            set(headers, "x-frame-options", "DENY");
            set(headers, "x-xss-protection", "0");
            set(
                headers,
                "referrer-policy",
                "strict-origin-when-cross-origin",
            );
            set(
                headers,
                "permissions-policy",
                "camera=(), microphone=(), geolocation=()",
            );

            Ok(resp)
        })
    }
}

fn set(headers: &mut axum::http::HeaderMap, key: &str, value: &str) {
    if let (Ok(k), Ok(v)) = (
        axum::http::HeaderName::from_bytes(key.as_bytes()),
        HeaderValue::from_str(value),
    ) {
        headers.insert(k, v);
    }
}
