//! Request fingerprinting middleware — bot detection via header analysis and behavioral heuristics.
//!
//! Computes a bot score (0-100) based on:
//! - Missing browser headers (+20-25 points each)
//! - Known bot user-agent patterns (+15 points)
//! - Metronomic request timing (+20 points)
//!
//! Classification:
//! - Human: score < 40
//! - Suspicious: 40 <= score < 70
//! - Bot: score >= 70
//!
//! Opt-in via `SECUREYEOMAN_FINGERPRINT_ENABLED=true`.

use std::sync::Arc;
use std::time::Instant;

use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, Response};
use axum::middleware::Next;
use dashmap::DashMap;

use crate::state::AppState;

/// Bot score thresholds.
const BOT_THRESHOLD: u32 = 70;
const SUSPICIOUS_THRESHOLD: u32 = 40;

/// Maximum timing entries per IP.
const MAX_TIMING_ENTRIES: usize = 5;

/// Timing state eviction after this many seconds of inactivity.
const TIMING_EVICT_SECS: u64 = 60;

/// Metronomic variance threshold (ms²). Below this = robotic.
const METRONOMIC_VARIANCE: f64 = 2500.0;

/// Known bot user-agent patterns (lowercase).
const BOT_UA_PATTERNS: &[&str] = &[
    "bot",
    "crawler",
    "spider",
    "scraper",
    "curl",
    "wget",
    "python-requests",
    "go-http-client",
    "java/",
    "okhttp",
    "httpclient",
    "libwww",
    "mechanize",
];

/// Headers that real browsers always send.
const BROWSER_HEADERS: &[&str] = &["accept", "accept-language", "accept-encoding", "user-agent"];

/// Shared fingerprinting state.
#[derive(Clone, Default)]
pub struct FingerprintState {
    /// Per-IP request timing for metronomic detection.
    timings: Arc<DashMap<String, Vec<Instant>>>,
}

impl FingerprintState {
    pub fn new() -> Self {
        Self {
            timings: Arc::new(DashMap::new()),
        }
    }

    /// Record a request timestamp for an IP and check for metronomic patterns.
    fn record_timing(&self, ip: &str) -> bool {
        let now = Instant::now();

        let mut entry = self.timings.entry(ip.to_string()).or_insert_with(Vec::new);

        // Evict stale entries
        if let Some(last) = entry.last() {
            if now.duration_since(*last).as_secs() > TIMING_EVICT_SECS {
                entry.clear();
            }
        }

        entry.push(now);
        if entry.len() > MAX_TIMING_ENTRIES {
            entry.remove(0);
        }

        // Need at least 5 timestamps to detect metronomic patterns
        if entry.len() < MAX_TIMING_ENTRIES {
            return false;
        }

        // Calculate intervals and variance
        let intervals: Vec<f64> = entry
            .windows(2)
            .map(|w| w[1].duration_since(w[0]).as_millis() as f64)
            .collect();

        let mean = intervals.iter().sum::<f64>() / intervals.len() as f64;
        let variance =
            intervals.iter().map(|i| (i - mean).powi(2)).sum::<f64>() / intervals.len() as f64;

        variance < METRONOMIC_VARIANCE
    }

    /// Lazy eviction of stale timing entries (every N checks).
    pub fn prune_stale(&self) {
        let now = Instant::now();
        self.timings.retain(|_, timestamps| {
            timestamps
                .last()
                .is_some_and(|t| now.duration_since(*t).as_secs() < TIMING_EVICT_SECS * 2)
        });
    }
}

/// Compute a bot score for a request.
fn compute_bot_score(req: &Request<Body>, ip: &str, state: &FingerprintState) -> u32 {
    let mut score: u32 = 0;
    let headers = req.headers();

    // Check for missing browser headers
    for &header in BROWSER_HEADERS {
        if !headers.contains_key(header) {
            score += if header == "user-agent" { 25 } else { 20 };
        }
    }

    // Check user-agent for bot patterns
    if let Some(ua) = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_lowercase())
    {
        if BOT_UA_PATTERNS.iter().any(|pattern| ua.contains(pattern)) {
            score += 15;
        }
    }

    // Check for metronomic timing
    if state.record_timing(ip) {
        score += 20;
    }

    score.min(100)
}

/// Extract client IP (same logic as rate_limit/local_network).
fn extract_ip(req: &Request<Body>) -> String {
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

    if let Some(addr) = req
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
    {
        return addr.0.ip().to_string();
    }

    "unknown".to_string()
}

/// Fingerprinting middleware — computes bot score and feeds into IP reputation.
pub async fn check_fingerprint(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response<Body> {
    let ip = extract_ip(&req);
    let fp_state = state.fingerprint();
    let score = compute_bot_score(&req, &ip, fp_state);

    // Feed into IP reputation for bots/suspicious requests
    if score >= BOT_THRESHOLD {
        if let Some(rep) = state.ip_reputation() {
            rep.record_violation(&ip, 15.0, "bot_detected");
        }
        tracing::debug!(ip = %ip, score, "bot detected by fingerprinting");
    } else if score >= SUSPICIOUS_THRESHOLD {
        if let Some(rep) = state.ip_reputation() {
            rep.record_violation(&ip, 5.0, "suspicious_request");
        }
    }

    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_headers_score_high() {
        let req = Request::get("/test").body(Body::empty()).unwrap();
        let state = FingerprintState::new();
        let score = compute_bot_score(&req, "1.2.3.4", &state);
        // Missing all 4 browser headers: 25 + 20 + 20 + 20 = 85
        assert!(score >= 80, "got {score}");
    }

    #[test]
    fn browser_like_headers_score_low() {
        let req = Request::get("/test")
            .header("accept", "text/html")
            .header("accept-language", "en-US")
            .header("accept-encoding", "gzip")
            .header(
                "user-agent",
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
            )
            .body(Body::empty())
            .unwrap();
        let state = FingerprintState::new();
        let score = compute_bot_score(&req, "1.2.3.4", &state);
        assert!(score < SUSPICIOUS_THRESHOLD, "got {score}");
    }

    #[test]
    fn bot_user_agent_adds_points() {
        let req = Request::get("/test")
            .header("accept", "text/html")
            .header("accept-language", "en-US")
            .header("accept-encoding", "gzip")
            .header("user-agent", "python-requests/2.28.0")
            .body(Body::empty())
            .unwrap();
        let state = FingerprintState::new();
        let score = compute_bot_score(&req, "1.2.3.4", &state);
        assert_eq!(score, 15);
    }

    #[test]
    fn metronomic_timing_detection() {
        let state = FingerprintState::new();
        // Simulate 5 requests at perfectly regular intervals
        for _ in 0..5 {
            state.record_timing("1.2.3.4");
        }
        // The 6th should detect metronomic pattern (0 variance)
        assert!(state.record_timing("1.2.3.4"));
    }

    #[test]
    fn different_ips_tracked_separately() {
        let state = FingerprintState::new();
        for _ in 0..5 {
            state.record_timing("1.2.3.4");
        }
        // Different IP should not have enough data
        assert!(!state.record_timing("5.6.7.8"));
    }
}
