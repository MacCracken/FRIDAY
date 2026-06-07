//! IP reputation middleware — tracks violation scores and blocks bad IPs.
//!
//! Features:
//! - Exponential score decay (configurable half-life)
//! - Auto-block when score exceeds threshold
//! - Auto-unblock after block duration expires or score decays
//! - Manual block/allow overrides
//! - Two-phase LRU eviction (non-blocked first, then expired blocks)
//!
//! Integrated with:
//! - Rate limiter: 429 responses feed 10 points
//! - Auth middleware: 401 responses feed 25 points

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::{Request, Response, StatusCode};
use axum::response::IntoResponse;
use dashmap::DashMap;
use serde_json::json;
use tower::{Layer, Service};

/// Configuration for the IP reputation system.
#[derive(Debug, Clone)]
pub struct IpReputationConfig {
    /// Score at which an IP is auto-blocked.
    pub threshold: f64,
    /// How long an auto-block lasts.
    pub block_duration: Duration,
    /// Half-life for exponential score decay.
    pub decay_half_life: Duration,
    /// Maximum number of tracked IPs.
    pub max_cache: usize,
}

impl Default for IpReputationConfig {
    fn default() -> Self {
        Self {
            threshold: 100.0,
            block_duration: Duration::from_secs(3600), // 1 hour
            decay_half_life: Duration::from_secs(3600), // 1 hour
            max_cache: 10_000,
        }
    }
}

struct IpRecord {
    score: f64,
    last_updated: Instant,
    blocked: bool,
    blocked_at: Option<Instant>,
    reason: String,
}

/// Shared IP reputation state.
#[derive(Clone)]
pub struct IpReputationState {
    records: Arc<DashMap<String, IpRecord>>,
    config: IpReputationConfig,
}

impl Default for IpReputationState {
    fn default() -> Self {
        Self::new(IpReputationConfig::default())
    }
}

impl IpReputationState {
    pub fn new(config: IpReputationConfig) -> Self {
        Self {
            records: Arc::new(DashMap::new()),
            config,
        }
    }

    /// Record a violation for an IP address.
    pub fn record_violation(&self, ip: &str, points: f64, reason: &str) {
        self.evict_if_full();

        let now = Instant::now();
        let mut entry = self
            .records
            .entry(ip.to_string())
            .or_insert_with(|| IpRecord {
                score: 0.0,
                last_updated: now,
                blocked: false,
                blocked_at: None,
                reason: String::new(),
            });

        // Apply decay before adding new points
        let decayed = self.decay_score(entry.score, entry.last_updated, now);
        entry.score = decayed + points;
        entry.last_updated = now;
        entry.reason = reason.to_string();

        // Auto-block if threshold exceeded
        if entry.score >= self.config.threshold && !entry.blocked {
            entry.blocked = true;
            entry.blocked_at = Some(now);
        }
    }

    /// Check if an IP is currently blocked.
    pub fn is_blocked(&self, ip: &str) -> Option<BlockInfo> {
        let mut entry = self.records.get_mut(ip)?;
        let now = Instant::now();

        if !entry.blocked {
            return None;
        }

        // Check block expiry
        if let Some(blocked_at) = entry.blocked_at
            && now.duration_since(blocked_at) >= self.config.block_duration
        {
            entry.blocked = false;
            entry.blocked_at = None;
            // Check if decayed score still warrants a block
            let decayed = self.decay_score(entry.score, entry.last_updated, now);
            entry.score = decayed;
            entry.last_updated = now;
            if decayed >= self.config.threshold {
                entry.blocked = true;
                entry.blocked_at = Some(now);
            } else {
                return None;
            }
        }

        let retry_after = entry
            .blocked_at
            .map(|ba| {
                self.config
                    .block_duration
                    .saturating_sub(now.duration_since(ba))
                    .as_secs()
            })
            .unwrap_or(0);

        Some(BlockInfo {
            reason: entry.reason.clone(),
            retry_after,
        })
    }

    /// Manually block an IP.
    pub fn manual_block(&self, ip: &str, reason: &str) {
        let now = Instant::now();
        self.records
            .entry(ip.to_string())
            .and_modify(|r| {
                r.blocked = true;
                r.blocked_at = Some(now);
                r.reason = reason.to_string();
                r.score = self.config.threshold;
            })
            .or_insert_with(|| IpRecord {
                score: self.config.threshold,
                last_updated: now,
                blocked: true,
                blocked_at: Some(now),
                reason: reason.to_string(),
            });
    }

    /// Manually allow an IP (removes all records).
    pub fn manual_allow(&self, ip: &str) {
        self.records.remove(ip);
    }

    /// Exponential decay formula.
    fn decay_score(&self, score: f64, last_updated: Instant, now: Instant) -> f64 {
        let elapsed = now.duration_since(last_updated).as_secs_f64();
        let half_life = self.config.decay_half_life.as_secs_f64();
        if half_life <= 0.0 || elapsed <= 0.0 {
            return score;
        }
        score * 0.5_f64.powf(elapsed / half_life)
    }

    /// Two-phase LRU eviction when cache is full.
    fn evict_if_full(&self) {
        if self.records.len() < self.config.max_cache {
            return;
        }

        let now = Instant::now();

        // Phase 1: Remove non-blocked entries with lowest (decayed) scores
        let mut candidates: Vec<(String, f64)> = self
            .records
            .iter()
            .filter(|e| !e.blocked)
            .map(|e| {
                let decayed = self.decay_score(e.score, e.last_updated, now);
                (e.key().clone(), decayed)
            })
            .collect();
        candidates.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

        let to_remove = self.records.len().saturating_sub(self.config.max_cache) + 1;
        for (ip, _) in candidates.iter().take(to_remove) {
            self.records.remove(ip);
        }

        // Phase 2: If still over capacity, remove expired blocks
        if self.records.len() >= self.config.max_cache {
            let expired: Vec<String> = self
                .records
                .iter()
                .filter(|e| {
                    e.blocked
                        && e.blocked_at
                            .is_some_and(|ba| now.duration_since(ba) >= self.config.block_duration)
                })
                .map(|e| e.key().clone())
                .collect();
            for ip in expired {
                self.records.remove(&ip);
            }
        }
    }
}

/// Information about a blocked IP.
pub struct BlockInfo {
    pub reason: String,
    pub retry_after: u64,
}

// --- Tower Layer ---

#[derive(Clone)]
pub struct IpReputationLayer {
    state: IpReputationState,
    /// Whether to trust `X-Forwarded-For` for client-IP (behind a trusted proxy).
    trust_proxy: bool,
}

impl IpReputationLayer {
    pub fn new(state: IpReputationState, trust_proxy: bool) -> Self {
        Self { state, trust_proxy }
    }
}

impl<S> Layer<S> for IpReputationLayer {
    type Service = IpReputationMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        IpReputationMiddleware {
            inner,
            state: self.state.clone(),
            trust_proxy: self.trust_proxy,
        }
    }
}

#[derive(Clone)]
pub struct IpReputationMiddleware<S> {
    inner: S,
    state: IpReputationState,
    trust_proxy: bool,
}

impl<S, ResBody> Service<Request<Body>> for IpReputationMiddleware<S>
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
        let ip = crate::middleware::client_ip::client_ip(&req, self.trust_proxy);
        let state = self.state.clone();
        let mut inner = self.inner.clone();

        Box::pin(async move {
            if let Some(info) = state.is_blocked(&ip) {
                return Ok((
                    StatusCode::FORBIDDEN,
                    [("retry-after", info.retry_after.to_string())],
                    axum::Json(json!({
                        "error": "IP address blocked",
                        "statusCode": 403,
                        "reason": info.reason,
                        "retryAfter": info.retry_after,
                    })),
                )
                    .into_response());
            }

            let resp = inner.call(req).await?;
            let (parts, body) = resp.into_parts();
            Ok(Response::from_parts(parts, Body::new(body)))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_violation_increases_score() {
        let state = IpReputationState::default();
        state.record_violation("1.2.3.4", 50.0, "test");
        let entry = state.records.get("1.2.3.4").unwrap();
        assert!(entry.score >= 50.0);
        assert!(!entry.blocked);
    }

    #[test]
    fn auto_blocks_at_threshold() {
        let state = IpReputationState::default();
        state.record_violation("1.2.3.4", 50.0, "test1");
        state.record_violation("1.2.3.4", 60.0, "test2");
        // Score now >= 100 (threshold)
        let entry = state.records.get("1.2.3.4").unwrap();
        assert!(entry.blocked);
    }

    #[test]
    fn is_blocked_returns_info_for_blocked_ip() {
        let state = IpReputationState::default();
        state.record_violation("1.2.3.4", 150.0, "flood");
        let info = state.is_blocked("1.2.3.4");
        assert!(info.is_some());
        assert_eq!(info.unwrap().reason, "flood");
    }

    #[test]
    fn is_blocked_returns_none_for_clean_ip() {
        let state = IpReputationState::default();
        assert!(state.is_blocked("1.2.3.4").is_none());
    }

    #[test]
    fn manual_block_works() {
        let state = IpReputationState::default();
        state.manual_block("1.2.3.4", "admin decision");
        assert!(state.is_blocked("1.2.3.4").is_some());
    }

    #[test]
    fn manual_allow_removes_block() {
        let state = IpReputationState::default();
        state.manual_block("1.2.3.4", "admin decision");
        state.manual_allow("1.2.3.4");
        assert!(state.is_blocked("1.2.3.4").is_none());
    }

    #[test]
    fn decay_reduces_score_over_time() {
        let config = IpReputationConfig {
            decay_half_life: Duration::from_millis(1), // very short for testing
            ..Default::default()
        };
        let state = IpReputationState::new(config);
        state.record_violation("1.2.3.4", 50.0, "test");

        // Wait for decay
        std::thread::sleep(Duration::from_millis(10));

        // Record a small violation to trigger decay recalculation
        state.record_violation("1.2.3.4", 1.0, "test2");
        let entry = state.records.get("1.2.3.4").unwrap();
        // After decay, score should be much less than 51
        assert!(
            entry.score < 10.0,
            "score should have decayed, got {}",
            entry.score
        );
    }

    #[test]
    fn eviction_removes_non_blocked_first() {
        let config = IpReputationConfig {
            max_cache: 3,
            ..Default::default()
        };
        let state = IpReputationState::new(config);
        state.record_violation("1.1.1.1", 10.0, "a");
        state.record_violation("2.2.2.2", 10.0, "b");
        state.record_violation("3.3.3.3", 10.0, "c");
        // Adding a 4th should evict one of the non-blocked entries
        state.record_violation("4.4.4.4", 10.0, "d");
        assert!(state.records.len() <= 3);
    }
}
