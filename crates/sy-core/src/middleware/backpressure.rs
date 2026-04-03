//! Backpressure middleware — sheds low-priority traffic under system pressure.
//!
//! Three pressure levels:
//! - Normal (0): All requests pass
//! - Elevated (1): Low-priority requests rejected with 503
//! - Critical (2): Only critical requests pass
//!
//! Route classification:
//! - Critical: health, auth, chat, websocket
//! - Low: metrics, training, analytics, diagnostics
//! - Normal: everything else

use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};

use axum::body::Body;
use axum::http::{Request, Response, StatusCode};
use axum::middleware::Next;
use axum::response::IntoResponse;
use serde_json::json;

/// Pressure levels.
pub const LEVEL_NORMAL: u8 = 0;
pub const LEVEL_ELEVATED: u8 = 1;
pub const LEVEL_CRITICAL: u8 = 2;

/// Route priority classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    Critical,
    Normal,
    Low,
}

/// Shared backpressure state.
#[derive(Clone)]
pub struct BackpressureState {
    level: Arc<AtomicU8>,
}

impl Default for BackpressureState {
    fn default() -> Self {
        Self::new()
    }
}

impl BackpressureState {
    pub fn new() -> Self {
        Self {
            level: Arc::new(AtomicU8::new(LEVEL_NORMAL)),
        }
    }

    /// Set the current pressure level (0=normal, 1=elevated, 2=critical).
    pub fn set_level(&self, level: u8) {
        self.level
            .store(level.min(LEVEL_CRITICAL), Ordering::Relaxed);
    }

    /// Get the current pressure level.
    pub fn get_level(&self) -> u8 {
        self.level.load(Ordering::Relaxed)
    }
}

/// Classify a request path into a priority level.
pub fn classify_priority(path: &str) -> Priority {
    // Critical routes — always allowed
    if path.starts_with("/health")
        || path.starts_with("/api/v1/auth/")
        || path.starts_with("/api/v1/chat")
        || path.starts_with("/ws/")
    {
        return Priority::Critical;
    }

    // Low-priority routes — shed first under pressure
    if path.starts_with("/metrics")
        || path.starts_with("/prom/metrics")
        || path.starts_with("/api/v1/training")
        || path.starts_with("/api/v1/analytics")
        || path.starts_with("/api/v1/diagnostics")
        || path.starts_with("/api/v1/reports")
    {
        return Priority::Low;
    }

    Priority::Normal
}

/// Backpressure middleware — rejects requests based on pressure level and route priority.
///
/// Uses `from_fn_with_state` with `AppState` — extracts `BackpressureState` from it.
pub async fn check_backpressure(
    axum::extract::State(state): axum::extract::State<crate::state::AppState>,
    req: Request<Body>,
    next: Next,
) -> Response<Body> {
    let level = state.backpressure().get_level();

    if level == LEVEL_NORMAL {
        return next.run(req).await;
    }

    let priority = classify_priority(req.uri().path());

    let should_reject = match level {
        LEVEL_ELEVATED => priority == Priority::Low,
        LEVEL_CRITICAL => priority != Priority::Critical,
        _ => false,
    };

    if should_reject {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [("retry-after", "30")],
            axum::Json(json!({
                "error": "Service under pressure — try again later",
                "statusCode": 503,
                "retryAfter": 30,
            })),
        )
            .into_response();
    }

    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_health_as_critical() {
        assert_eq!(classify_priority("/health"), Priority::Critical);
        assert_eq!(classify_priority("/health/live"), Priority::Critical);
    }

    #[test]
    fn classify_auth_as_critical() {
        assert_eq!(classify_priority("/api/v1/auth/login"), Priority::Critical);
    }

    #[test]
    fn classify_chat_as_critical() {
        assert_eq!(classify_priority("/api/v1/chat"), Priority::Critical);
        assert_eq!(classify_priority("/api/v1/chat/stream"), Priority::Critical);
    }

    #[test]
    fn classify_ws_as_critical() {
        assert_eq!(classify_priority("/ws/metrics"), Priority::Critical);
    }

    #[test]
    fn classify_metrics_as_low() {
        assert_eq!(classify_priority("/metrics"), Priority::Low);
        assert_eq!(classify_priority("/prom/metrics"), Priority::Low);
    }

    #[test]
    fn classify_training_as_low() {
        assert_eq!(classify_priority("/api/v1/training/jobs"), Priority::Low);
    }

    #[test]
    fn classify_brain_as_normal() {
        assert_eq!(
            classify_priority("/api/v1/brain/memories"),
            Priority::Normal
        );
    }

    #[test]
    fn set_and_get_level() {
        let state = BackpressureState::new();
        assert_eq!(state.get_level(), LEVEL_NORMAL);
        state.set_level(LEVEL_ELEVATED);
        assert_eq!(state.get_level(), LEVEL_ELEVATED);
        state.set_level(LEVEL_CRITICAL);
        assert_eq!(state.get_level(), LEVEL_CRITICAL);
    }

    #[test]
    fn level_clamped_to_critical() {
        let state = BackpressureState::new();
        state.set_level(255);
        assert_eq!(state.get_level(), LEVEL_CRITICAL);
    }
}
