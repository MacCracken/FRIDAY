//! Application state shared across all handlers via axum State extractor.

use sqlx::PgPool;
use std::sync::Arc;
use std::time::Instant;
use sy_types::CoreConfig;
use tokio::sync::broadcast;

use crate::auth::jwt::JwtConfig;
use crate::auth::middleware::AuthContext;

/// Shared application state — cloned into every request via `Arc`.
#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

/// Payload for the event bridge broadcast channel.
#[derive(Clone, Debug)]
pub struct BridgeEvent {
    pub event: String,
    pub data: String,
    pub source: String,
}

struct AppStateInner {
    pub config: CoreConfig,
    pub jwt_config: JwtConfig,
    pub db_pool: Option<PgPool>,
    pub started_at: Instant,
    pub version: String,
    pub bridge_tx: broadcast::Sender<BridgeEvent>,
}

impl AppState {
    pub fn new(config: CoreConfig) -> Self {
        let jwt_secret = std::env::var("SECUREYEOMAN_JWT_SECRET")
            .unwrap_or_else(|_| "dev-jwt-secret-change-in-production!!".to_string());

        let jwt_config = JwtConfig {
            secret: jwt_secret,
            previous_secret: std::env::var("SECUREYEOMAN_JWT_SECRET_PREVIOUS").ok(),
            ..Default::default()
        };

        let (bridge_tx, _) = broadcast::channel(1024);

        Self {
            inner: Arc::new(AppStateInner {
                config,
                jwt_config,
                db_pool: None,
                started_at: Instant::now(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                bridge_tx,
            }),
        }
    }

    /// Set the database pool (called after async pool creation).
    pub fn with_db(mut self, pool: PgPool) -> Self {
        // Safe: only called during init before any clones
        Arc::get_mut(&mut self.inner).unwrap().db_pool = Some(pool);
        self
    }

    pub fn db(&self) -> Option<&PgPool> {
        self.inner.db_pool.as_ref()
    }

    pub fn config(&self) -> &CoreConfig {
        &self.inner.config
    }

    pub fn jwt_config(&self) -> &JwtConfig {
        &self.inner.jwt_config
    }

    pub fn uptime_seconds(&self) -> f64 {
        self.inner.started_at.elapsed().as_secs_f64()
    }

    pub fn version(&self) -> &str {
        &self.inner.version
    }

    /// Get a new receiver for the event bridge broadcast channel.
    pub fn bridge_subscribe(&self) -> broadcast::Receiver<BridgeEvent> {
        self.inner.bridge_tx.subscribe()
    }

    /// Broadcast an event to all connected event bridge SSE clients.
    pub fn bridge_broadcast(&self, event: BridgeEvent) -> usize {
        self.inner.bridge_tx.send(event).unwrap_or(0)
    }

    /// Fastify fallback URL for the reverse proxy (during migration).
    pub fn fastify_url(&self) -> Option<String> {
        self.inner
            .config
            .fastify_fallback_port
            .map(|port| format!("http://127.0.0.1:{port}"))
    }

    /// Validate an API key — stub for Phase 7.1.
    /// TODO: Implement SHA-256 hash lookup against database.
    pub fn validate_api_key(&self, _api_key: &str) -> Option<AuthContext> {
        // Will be implemented when database layer is added
        None
    }
}
