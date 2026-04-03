//! Rate limiting middleware — per-IP sliding window with tiered limits.
//!
//! Tiers:
//! - auth: 5 req/min (login, register, token endpoints)
//! - chat: 30 req/min (chat and streaming endpoints)
//! - general: 120 req/min (everything else)
//!
//! Returns 429 Too Many Requests with Retry-After header when exceeded.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::{HeaderValue, Request, Response, StatusCode};
use axum::response::IntoResponse;
use dashmap::DashMap;
use serde_json::json;
use tower::{Layer, Service};

/// Rate limit tier configuration.
#[derive(Debug, Clone)]
pub struct RateTier {
    pub max_requests: u32,
    pub window: Duration,
}

/// Sliding window counter for a single key.
struct WindowCounter {
    count: u32,
    window_start: Instant,
    window_duration: Duration,
}

impl WindowCounter {
    fn new(window: Duration) -> Self {
        Self {
            count: 0,
            window_start: Instant::now(),
            window_duration: window,
        }
    }

    /// Check and increment. Returns Ok(remaining) or Err(retry_after_secs).
    fn check_and_increment(&mut self, max: u32) -> Result<u32, u64> {
        let now = Instant::now();
        let elapsed = now.duration_since(self.window_start);

        if elapsed >= self.window_duration {
            // Window expired — reset
            self.window_start = now;
            self.count = 1;
            return Ok(max.saturating_sub(1));
        }

        if self.count >= max {
            let retry_after = (self.window_duration - elapsed).as_secs() + 1;
            return Err(retry_after);
        }

        self.count += 1;
        Ok(max - self.count)
    }
}

/// Shared rate limit state.
#[derive(Clone)]
pub struct RateLimitState {
    counters: Arc<DashMap<String, WindowCounter>>,
    auth_tier: RateTier,
    chat_tier: RateTier,
    general_tier: RateTier,
    /// Counter for lazy pruning — prune every N checks.
    check_count: Arc<std::sync::atomic::AtomicU64>,
}

impl Default for RateLimitState {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimitState {
    pub fn new() -> Self {
        Self {
            counters: Arc::new(DashMap::new()),
            auth_tier: RateTier {
                max_requests: 5,
                window: Duration::from_secs(60),
            },
            chat_tier: RateTier {
                max_requests: 30,
                window: Duration::from_secs(60),
            },
            general_tier: RateTier {
                max_requests: 120,
                window: Duration::from_secs(60),
            },
            check_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }
    }

    /// Check if a request is allowed. Returns Ok(remaining) or Err(retry_after_secs).
    pub fn check(&self, ip: &str, path: &str) -> Result<u32, u64> {
        // Lazy pruning: every 1000 checks, remove expired entries
        let count = self
            .check_count
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if count % 1000 == 999 {
            self.prune_expired();
        }

        let (tier_name, tier) = self.classify(path);
        let key = format!("{tier_name}:{ip}");

        let mut entry = self
            .counters
            .entry(key)
            .or_insert_with(|| WindowCounter::new(tier.window));
        entry.check_and_increment(tier.max_requests)
    }

    /// Classify a path into a rate limit tier.
    fn classify(&self, path: &str) -> (&str, &RateTier) {
        if path.starts_with("/api/v1/auth/") {
            ("auth", &self.auth_tier)
        } else if path.starts_with("/api/v1/chat") {
            ("chat", &self.chat_tier)
        } else {
            ("general", &self.general_tier)
        }
    }

    /// Prune expired entries to prevent unbounded memory growth.
    pub fn prune_expired(&self) {
        let now = Instant::now();
        self.counters.retain(|_, counter| {
            now.duration_since(counter.window_start) < counter.window_duration * 2
        });
    }
}

// --- Tower Layer ---

#[derive(Clone)]
pub struct RateLimitLayer {
    state: RateLimitState,
}

impl RateLimitLayer {
    pub fn new(state: RateLimitState) -> Self {
        Self { state }
    }
}

impl<S> Layer<S> for RateLimitLayer {
    type Service = RateLimitMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RateLimitMiddleware {
            inner,
            state: self.state.clone(),
        }
    }
}

#[derive(Clone)]
pub struct RateLimitMiddleware<S> {
    inner: S,
    state: RateLimitState,
}

impl<S, ResBody> Service<Request<Body>> for RateLimitMiddleware<S>
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
        let ip = extract_client_ip(&req);
        let path = req.uri().path().to_string();
        let state = self.state.clone();
        let mut inner = self.inner.clone();

        Box::pin(async move {
            match state.check(&ip, &path) {
                Ok(remaining) => {
                    let resp = inner.call(req).await?;
                    // Map the response body type — add rate limit headers
                    let (mut parts, body) = resp.into_parts();
                    if let Ok(val) = HeaderValue::from_str(&remaining.to_string()) {
                        parts.headers.insert("x-ratelimit-remaining", val);
                    }
                    // Re-wrap the body into Body using http_body_util
                    let mapped = Response::from_parts(parts, Body::new(body));
                    Ok(mapped)
                }
                Err(retry_after) => {
                    let resp = (
                        StatusCode::TOO_MANY_REQUESTS,
                        [("retry-after", retry_after.to_string())],
                        axum::Json(json!({
                            "error": "Too many requests",
                            "statusCode": 429,
                            "retryAfter": retry_after
                        })),
                    )
                        .into_response();
                    Ok(resp)
                }
            }
        })
    }
}

/// Extract client IP from X-Forwarded-For or fall back to peer address.
fn extract_client_ip<B>(req: &Request<B>) -> String {
    // Try X-Forwarded-For first (first IP in the chain)
    if let Some(forwarded) = req.headers().get("x-forwarded-for") {
        if let Ok(val) = forwarded.to_str() {
            if let Some(first_ip) = val.split(',').next() {
                let trimmed = first_ip.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }

    // Fall back to ConnectInfo if available (axum injects this from the socket)
    if let Some(addr) = req
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
    {
        return addr.0.ip().to_string();
    }

    // Last resort — unknown (still rate-limited as a single bucket)
    "unknown".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_auth_routes() {
        let state = RateLimitState::new();
        assert_eq!(state.classify("/api/v1/auth/login").0, "auth");
        assert_eq!(state.classify("/api/v1/auth/register").0, "auth");
    }

    #[test]
    fn classify_chat_routes() {
        let state = RateLimitState::new();
        assert_eq!(state.classify("/api/v1/chat").0, "chat");
        assert_eq!(state.classify("/api/v1/chat/stream").0, "chat");
    }

    #[test]
    fn classify_general_routes() {
        let state = RateLimitState::new();
        assert_eq!(state.classify("/api/v1/brain/memories").0, "general");
        assert_eq!(state.classify("/health").0, "general");
    }

    #[test]
    fn allows_requests_within_limit() {
        let state = RateLimitState::new();
        for _ in 0..5 {
            assert!(state.check("1.2.3.4", "/api/v1/auth/login").is_ok());
        }
    }

    #[test]
    fn rejects_after_limit_exceeded() {
        let state = RateLimitState::new();
        // Auth tier: 5/min
        for _ in 0..5 {
            let _ = state.check("1.2.3.4", "/api/v1/auth/login");
        }
        assert!(state.check("1.2.3.4", "/api/v1/auth/login").is_err());
    }

    #[test]
    fn different_ips_have_separate_limits() {
        let state = RateLimitState::new();
        for _ in 0..5 {
            let _ = state.check("1.2.3.4", "/api/v1/auth/login");
        }
        // Different IP should still be allowed
        assert!(state.check("5.6.7.8", "/api/v1/auth/login").is_ok());
    }

    #[test]
    fn prune_removes_expired_entries() {
        let state = RateLimitState::new();
        let _ = state.check("1.2.3.4", "/api/v1/auth/login");
        assert!(!state.counters.is_empty());

        // Manually expire the entry by setting window_start to the past
        if let Some(mut entry) = state.counters.get_mut("auth:1.2.3.4") {
            entry.window_start = Instant::now() - Duration::from_secs(300);
        }
        state.prune_expired();
        assert!(state.counters.is_empty());
    }
}
