//! Application state shared across all handlers via axum State extractor.

use crate::types::CoreConfig;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::broadcast;

use crate::auth::jwt::JwtConfig;
use crate::auth::middleware::{AuthContext, AuthMethod};
use crate::auth::oidc::OidcRuntime;
use crate::brain::embedding::{
    EmbeddingProvider, NoopEmbeddingProvider, OllamaEmbeddingProvider, OpenAiEmbeddingProvider,
};
use crate::brain::manager::{BrainConfig, BrainManager};
use crate::brain::pg_vector::{DynVectorStore, PgVectorStore};
use crate::integrations::github::GitHubClient;
use crate::integrations::gmail::GmailClient;
use crate::integrations::google_calendar::GoogleCalendarClient;
use crate::integrations::jira::JiraClient;
use crate::integrations::linear::LinearClient;
use crate::integrations::notion::NotionClient;
use crate::integrations::todoist::TodoistClient;
use crate::integrations::twitter::TwitterClient;
use crate::middleware::backpressure::BackpressureState;
use crate::middleware::fingerprinting::FingerprintState;
use crate::middleware::ip_reputation::IpReputationState;
use crate::privacy::ClassificationEngine;
use webauthn_rs::Webauthn;
use webauthn_rs::prelude::{PasskeyAuthentication, PasskeyRegistration};

/// Type-erased brain manager for use in AppState.
/// Uses dynamic dispatch so AppState doesn't need generics.
/// Uses DynVectorStore which dispatches to InMemory or Postgres at runtime.
pub type DynBrainManager = BrainManager<DynEmbeddingProvider, DynVectorStore>;

/// Dynamic dispatch wrapper for embedding providers.
pub struct DynEmbeddingProvider(Box<dyn EmbeddingProviderDyn>);

trait EmbeddingProviderDyn: Send + Sync {
    fn embed_dyn<'a>(
        &'a self,
        texts: &'a [String],
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = crate::brain::embedding::EmbedResult> + Send + 'a>,
    >;
    fn dimensions_dyn(&self) -> usize;
    fn name_dyn(&self) -> &str;
}

impl<T: EmbeddingProvider + 'static> EmbeddingProviderDyn for T {
    fn embed_dyn<'a>(
        &'a self,
        texts: &'a [String],
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = crate::brain::embedding::EmbedResult> + Send + 'a>,
    > {
        Box::pin(self.embed(texts))
    }
    fn dimensions_dyn(&self) -> usize {
        self.dimensions()
    }
    fn name_dyn(&self) -> &str {
        self.name()
    }
}

impl EmbeddingProvider for DynEmbeddingProvider {
    async fn embed(&self, texts: &[String]) -> crate::brain::embedding::EmbedResult {
        self.0.embed_dyn(texts).await
    }
    fn dimensions(&self) -> usize {
        self.0.dimensions_dyn()
    }
    fn name(&self) -> &str {
        self.0.name_dyn()
    }
}

impl DynEmbeddingProvider {
    pub fn new<T: EmbeddingProvider + 'static>(provider: T) -> Self {
        Self(Box::new(provider))
    }
}

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
    pub allow_remote_access: bool,
    /// Honor `X-Forwarded-For` for client-IP determination. Only enable when the
    /// server sits behind a trusted reverse proxy that overwrites the header;
    /// otherwise the header is attacker-controlled and must be ignored (default).
    pub trust_proxy_headers: bool,
    pub backpressure: BackpressureState,
    /// In-memory cache of revoked JTIs (avoids DB hit per request).
    pub revoked_tokens: Arc<dashmap::DashMap<String, Instant>>,
    pub fingerprint: FingerprintState,
    pub ip_reputation: Option<IpReputationState>,
    /// DLP/PII classification engine — compiled once (regexes are not cheap).
    pub pii_engine: Arc<ClassificationEngine>,
    /// WebAuthn relying-party instance + in-flight ceremony state.
    pub webauthn: Arc<Webauthn>,
    pub webauthn_reg: Arc<WebauthnRegStore>,
    pub webauthn_auth: Arc<WebauthnAuthStore>,
    /// OIDC SSO runtime — `Some` only when `OIDC_*` env vars are configured.
    pub oidc: Option<Arc<OidcRuntime>>,
    pub bridge_tx: broadcast::Sender<BridgeEvent>,
    pub brain: Option<Arc<DynBrainManager>>,
    pub github_client: Option<Arc<GitHubClient>>,
    pub gmail_client: Option<Arc<GmailClient>>,
    pub google_calendar_client: Option<Arc<GoogleCalendarClient>>,
    pub jira_client: Option<Arc<JiraClient>>,
    pub linear_client: Option<Arc<LinearClient>>,
    pub notion_client: Option<Arc<NotionClient>>,
    pub todoist_client: Option<Arc<TodoistClient>>,
    pub twitter_client: Option<Arc<TwitterClient>>,
}

/// The well-known development JWT secret that must never sign tokens in an
/// exposed deployment — anyone with it could forge admin tokens.
pub const DEV_JWT_PLACEHOLDER: &str = "dev-jwt-secret-change-in-production!!";

/// Whether a JWT signing secret is strong enough: at least 32 bytes and not the
/// well-known development placeholder.
pub fn is_strong_jwt_secret(secret: &str) -> bool {
    secret.len() >= 32 && secret != DEV_JWT_PLACEHOLDER
}

/// Generate a cryptographically-random ephemeral JWT secret (48 bytes, base64).
fn generate_ephemeral_secret() -> String {
    use base64::Engine;
    use rand::RngCore;
    let mut bytes = [0u8; 48];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::STANDARD_NO_PAD.encode(bytes)
}

/// In-flight WebAuthn ceremony state, keyed by user id, with a creation instant
/// for TTL eviction (ceremonies are short-lived; ~60s challenge timeout).
pub type WebauthnRegStore = dashmap::DashMap<String, (PasskeyRegistration, Instant)>;
pub type WebauthnAuthStore = dashmap::DashMap<String, (PasskeyAuthentication, Instant)>;

/// Build the OIDC runtime from `OIDC_*` env vars, or `None` if unconfigured.
fn build_oidc() -> Option<Arc<OidcRuntime>> {
    let config = crate::auth::oidc::OidcConfig::from_env()?;
    match OidcRuntime::new(config) {
        Ok(rt) => {
            tracing::info!("OIDC SSO configured");
            Some(Arc::new(rt))
        }
        Err(e) => {
            tracing::warn!(error = %e, "OIDC configured but runtime init failed; SSO disabled");
            None
        }
    }
}

/// Build the WebAuthn relying-party instance from `SECUREYEOMAN_RP_ID` /
/// `SECUREYEOMAN_RP_ORIGIN` (defaults: localhost). `rp_id` is the registrable
/// domain (no scheme/port); `rp_origin` must match the browser's `window.origin`.
/// Falls back to a valid localhost config (with a warning) if the env values are
/// invalid, so the server always has a usable instance.
fn build_webauthn() -> Webauthn {
    use webauthn_rs::WebauthnBuilder;
    use webauthn_rs::prelude::Url;

    let rp_id = std::env::var("SECUREYEOMAN_RP_ID").unwrap_or_else(|_| "localhost".to_string());
    let rp_origin_str = std::env::var("SECUREYEOMAN_RP_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:18789".to_string());

    let built = Url::parse(&rp_origin_str).ok().and_then(|origin| {
        WebauthnBuilder::new(&rp_id, &origin)
            .and_then(|b| b.rp_name("SecureYeoman").build())
            .ok()
    });

    match built {
        Some(w) => w,
        None => {
            tracing::warn!(
                rp_id = %rp_id,
                rp_origin = %rp_origin_str,
                "invalid WebAuthn RP config; falling back to http://localhost"
            );
            let origin = Url::parse("http://localhost").expect("static localhost url");
            WebauthnBuilder::new("localhost", &origin)
                .and_then(|b| b.build())
                .expect("localhost WebAuthn config is always valid")
        }
    }
}

impl AppState {
    pub fn new(config: CoreConfig) -> Self {
        // Resolve the JWT signing secret. We NEVER fall back to a known/guessable
        // value — a hardcoded secret would let anyone forge admin tokens. When the
        // env secret is absent or weak we synthesize a random ephemeral secret
        // (tokens then don't survive a restart). main() additionally REFUSES to
        // boot exposed (non-loopback / remote-access) without a strong secret.
        let jwt_secret = match std::env::var("SECUREYEOMAN_JWT_SECRET") {
            Ok(s) if is_strong_jwt_secret(&s) => s,
            Ok(_) => {
                tracing::warn!(
                    "SECUREYEOMAN_JWT_SECRET is too weak (need >= 32 bytes and not the dev \
                     placeholder); using a random ephemeral secret for this run"
                );
                generate_ephemeral_secret()
            }
            Err(_) => {
                tracing::warn!(
                    "SECUREYEOMAN_JWT_SECRET not set; using a random ephemeral secret for this \
                     run — issued tokens will not survive a restart. Set SECUREYEOMAN_JWT_SECRET \
                     in any persistent or exposed deployment."
                );
                generate_ephemeral_secret()
            }
        };

        let jwt_config = JwtConfig {
            secret: jwt_secret,
            previous_secret: std::env::var("SECUREYEOMAN_JWT_SECRET_PREVIOUS").ok(),
            ..Default::default()
        };

        let (bridge_tx, _) = broadcast::channel(1024);

        // Initialize integration clients from environment variables.
        // These don't require a database connection.
        let github_client = std::env::var("GITHUB_TOKEN").ok().map(|token| {
            tracing::info!("GitHub integration client initialized from GITHUB_TOKEN");
            Arc::new(GitHubClient::new(token))
        });

        let jira_client = match (
            std::env::var("JIRA_BASE_URL"),
            std::env::var("JIRA_EMAIL"),
            std::env::var("JIRA_API_TOKEN"),
        ) {
            (Ok(base_url), Ok(email), Ok(api_token)) => {
                tracing::info!("Jira integration client initialized from env vars");
                Some(Arc::new(JiraClient::new(base_url, email, api_token)))
            }
            _ => None,
        };

        let notion_client = std::env::var("NOTION_API_KEY").ok().map(|token| {
            tracing::info!("Notion integration client initialized from NOTION_API_KEY");
            Arc::new(NotionClient::new(token))
        });

        let todoist_client = std::env::var("TODOIST_API_KEY").ok().map(|token| {
            tracing::info!("Todoist integration client initialized from TODOIST_API_KEY");
            Arc::new(TodoistClient::new(token))
        });

        let gmail_client = std::env::var("GMAIL_OAUTH_TOKEN").ok().map(|token| {
            tracing::info!("Gmail integration client initialized from GMAIL_OAUTH_TOKEN");
            Arc::new(GmailClient::new(token))
        });

        let google_calendar_client =
            std::env::var("GOOGLE_CALENDAR_OAUTH_TOKEN").ok().map(|token| {
                tracing::info!(
                    "Google Calendar integration client initialized from GOOGLE_CALENDAR_OAUTH_TOKEN"
                );
                Arc::new(GoogleCalendarClient::new(token))
            });

        let twitter_client = std::env::var("TWITTER_BEARER_TOKEN").ok().map(|token| {
            tracing::info!("Twitter integration client initialized from TWITTER_BEARER_TOKEN");
            Arc::new(TwitterClient::new(token))
        });

        let linear_client = std::env::var("LINEAR_API_KEY").ok().map(|key| {
            tracing::info!("Linear integration client initialized from LINEAR_API_KEY");
            Arc::new(LinearClient::new(key))
        });

        Self {
            inner: Arc::new(AppStateInner {
                config,
                jwt_config,
                db_pool: None,
                started_at: Instant::now(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                allow_remote_access: std::env::var("SECUREYEOMAN_ALLOW_REMOTE_ACCESS")
                    .ok()
                    .is_some_and(|v| v == "true" || v == "1"),
                trust_proxy_headers: std::env::var("SECUREYEOMAN_TRUST_PROXY_HEADERS")
                    .ok()
                    .is_some_and(|v| v == "true" || v == "1"),
                backpressure: BackpressureState::new(),
                revoked_tokens: Arc::new(dashmap::DashMap::new()),
                fingerprint: FingerprintState::new(),
                ip_reputation: Some(IpReputationState::default()),
                pii_engine: Arc::new(ClassificationEngine::new()),
                webauthn: Arc::new(build_webauthn()),
                webauthn_reg: Arc::new(WebauthnRegStore::new()),
                webauthn_auth: Arc::new(WebauthnAuthStore::new()),
                oidc: build_oidc(),
                bridge_tx,
                brain: None,
                github_client,
                gmail_client,
                google_calendar_client,
                jira_client,
                linear_client,
                notion_client,
                todoist_client,
                twitter_client,
            }),
        }
    }

    /// Set the database pool and initialize managers.
    pub fn with_db(mut self, pool: PgPool) -> Self {
        // Initialize brain manager with appropriate embedding provider
        let embedding = Self::create_embedding_provider();

        // Use PgVectorStore when database is available, otherwise InMemory
        let vector_store =
            DynVectorStore::Postgres(PgVectorStore::new(pool.clone(), "default".to_string()));

        let brain = BrainManager::new(
            pool.clone(),
            "default".to_string(),
            BrainConfig::default(),
            embedding,
            vector_store,
        );

        let inner = Arc::get_mut(&mut self.inner).unwrap();
        inner.db_pool = Some(pool);
        inner.brain = Some(Arc::new(brain));
        self
    }

    pub fn db(&self) -> Option<&PgPool> {
        self.inner.db_pool.as_ref()
    }

    pub fn allow_remote_access(&self) -> bool {
        self.inner.allow_remote_access
    }

    /// Whether `X-Forwarded-For` should be trusted for client-IP determination.
    /// Defaults to false; enable only behind a trusted reverse proxy.
    pub fn trust_proxy_headers(&self) -> bool {
        self.inner.trust_proxy_headers
    }

    pub fn backpressure(&self) -> &BackpressureState {
        &self.inner.backpressure
    }

    pub fn fingerprint(&self) -> &FingerprintState {
        &self.inner.fingerprint
    }

    pub fn ip_reputation(&self) -> Option<&IpReputationState> {
        self.inner.ip_reputation.as_ref()
    }

    /// The shared DLP/PII classification engine.
    pub fn pii_engine(&self) -> &ClassificationEngine {
        &self.inner.pii_engine
    }

    /// The WebAuthn relying-party instance.
    pub fn webauthn(&self) -> &Webauthn {
        &self.inner.webauthn
    }

    /// In-flight WebAuthn registration ceremony state (keyed by user id).
    pub fn webauthn_reg(&self) -> &WebauthnRegStore {
        &self.inner.webauthn_reg
    }

    /// In-flight WebAuthn authentication ceremony state (keyed by user id).
    pub fn webauthn_auth(&self) -> &WebauthnAuthStore {
        &self.inner.webauthn_auth
    }

    /// The OIDC SSO runtime, if configured via `OIDC_*` env vars.
    pub fn oidc(&self) -> Option<&Arc<OidcRuntime>> {
        self.inner.oidc.as_ref()
    }

    /// Check if a token JTI has been revoked (cache → DB fallback).
    pub async fn is_token_revoked(&self, jti: &str) -> bool {
        // Check in-memory cache first
        if self.inner.revoked_tokens.contains_key(jti) {
            return true;
        }

        // Fallback to DB
        if let Some(pool) = self.db()
            && let Ok(revoked) = crate::db::auth::is_token_revoked(pool, jti).await
            && revoked
        {
            // Populate cache
            self.inner
                .revoked_tokens
                .insert(jti.to_string(), Instant::now());
            return true;
        }

        false
    }

    /// Revoke a token by JTI (adds to cache + DB).
    pub async fn revoke_token(&self, jti: &str, user_id: &str, expires_at: i64) {
        self.inner
            .revoked_tokens
            .insert(jti.to_string(), Instant::now());
        if let Some(pool) = self.db() {
            let _ = crate::db::auth::revoke_token(pool, jti, user_id, expires_at).await;
        }
    }

    /// Override the remote access setting (useful for testing).
    pub fn with_allow_remote_access(mut self, allow: bool) -> Self {
        let inner = Arc::get_mut(&mut self.inner).unwrap();
        inner.allow_remote_access = allow;
        self
    }

    /// Override the trusted-proxy setting (useful for testing).
    pub fn with_trust_proxy_headers(mut self, trust: bool) -> Self {
        let inner = Arc::get_mut(&mut self.inner).unwrap();
        inner.trust_proxy_headers = trust;
        self
    }

    /// Override the JWT signing secret (useful for tests, which need a known,
    /// strong secret that matches the tokens they issue).
    pub fn with_jwt_secret(mut self, secret: impl Into<String>) -> Self {
        let inner = Arc::get_mut(&mut self.inner).unwrap();
        inner.jwt_config.secret = secret.into();
        self
    }

    /// Get the brain manager (memory, knowledge, RAG).
    pub fn brain(&self) -> Option<&Arc<DynBrainManager>> {
        self.inner.brain.as_ref()
    }

    /// Get the GitHub typed client (initialized from `GITHUB_TOKEN` env var).
    pub fn github(&self) -> Option<&Arc<GitHubClient>> {
        self.inner.github_client.as_ref()
    }

    /// Get the Jira typed client (initialized from `JIRA_BASE_URL` + `JIRA_EMAIL` + `JIRA_API_TOKEN`).
    pub fn jira(&self) -> Option<&Arc<JiraClient>> {
        self.inner.jira_client.as_ref()
    }

    /// Get the Notion typed client (initialized from `NOTION_API_KEY` env var).
    pub fn notion(&self) -> Option<&Arc<NotionClient>> {
        self.inner.notion_client.as_ref()
    }

    /// Get the Todoist typed client (initialized from `TODOIST_API_KEY` env var).
    pub fn todoist(&self) -> Option<&Arc<TodoistClient>> {
        self.inner.todoist_client.as_ref()
    }

    /// Get the Gmail typed client (initialized from `GMAIL_OAUTH_TOKEN` env var).
    pub fn gmail(&self) -> Option<&Arc<GmailClient>> {
        self.inner.gmail_client.as_ref()
    }

    /// Get the Google Calendar typed client (initialized from `GOOGLE_CALENDAR_OAUTH_TOKEN` env var).
    pub fn google_calendar(&self) -> Option<&Arc<GoogleCalendarClient>> {
        self.inner.google_calendar_client.as_ref()
    }

    /// Get the Twitter typed client (initialized from `TWITTER_BEARER_TOKEN` env var).
    pub fn twitter(&self) -> Option<&Arc<TwitterClient>> {
        self.inner.twitter_client.as_ref()
    }

    /// Get the Linear typed client (initialized from `LINEAR_API_KEY` env var).
    pub fn linear(&self) -> Option<&Arc<LinearClient>> {
        self.inner.linear_client.as_ref()
    }

    /// Create the embedding provider based on environment configuration.
    fn create_embedding_provider() -> DynEmbeddingProvider {
        // Priority: OPENAI_API_KEY → OLLAMA_HOST → HOOSH_URL → noop
        if let Ok(api_key) = std::env::var("OPENAI_API_KEY") {
            let model = std::env::var("EMBEDDING_MODEL").ok();
            tracing::info!(provider = "openai", "embedding provider initialized");
            return DynEmbeddingProvider::new(OpenAiEmbeddingProvider::openai(
                &api_key,
                model.as_deref(),
            ));
        }

        if std::env::var("OLLAMA_HOST").is_ok() || std::env::var("OLLAMA_URL").is_ok() {
            let config = crate::brain::embedding::OllamaEmbeddingConfig {
                base_url: std::env::var("OLLAMA_HOST")
                    .or_else(|_| std::env::var("OLLAMA_URL"))
                    .unwrap_or_else(|_| "http://localhost:11434".to_string()),
                model: std::env::var("OLLAMA_EMBED_MODEL")
                    .unwrap_or_else(|_| "nomic-embed-text".to_string()),
            };
            tracing::info!(
                provider = "ollama",
                model = config.model,
                "embedding provider initialized"
            );
            return DynEmbeddingProvider::new(OllamaEmbeddingProvider::new(config));
        }

        let hoosh_url = std::env::var("HOOSH_URL")
            .or_else(|_| std::env::var("AGNOS_GATEWAY_URL"))
            .ok();
        if hoosh_url.is_some() {
            let api_key = std::env::var("AGNOS_GATEWAY_API_KEY").ok();
            tracing::info!(provider = "hoosh", "embedding provider initialized");
            return DynEmbeddingProvider::new(OpenAiEmbeddingProvider::hoosh(
                hoosh_url.as_deref(),
                api_key,
            ));
        }

        tracing::warn!("no embedding provider configured — using noop (no vector search)");
        DynEmbeddingProvider::new(NoopEmbeddingProvider)
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

    /// Validate an API key by SHA-256 hash lookup against the database.
    pub async fn validate_api_key(&self, api_key: &str) -> Option<AuthContext> {
        let pool = self.db()?;

        // SHA-256 hash the incoming key
        let hash = crate::crypto::sha256(api_key.as_bytes());

        // Look up the hash in the database
        let row = crate::db::auth::find_api_key_by_hash(pool, &hash)
            .await
            .ok()??;

        // Determine role from permissions (default to "service")
        let role = row
            .permissions
            .get("role")
            .and_then(|r| r.as_str())
            .unwrap_or("service")
            .to_string();

        // Optional least-privilege scope: a `permissions` array of
        // "resource:action" strings in the key's config further restricts it
        // below its role. Absent => inherit the role (backward compatible).
        let permissions = row
            .permissions
            .get("permissions")
            .and_then(|p| p.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        // Update last_used_at in background (don't block auth)
        let pool_clone = pool.clone();
        let key_id = row.id.clone();
        tokio::spawn(async move {
            let _ = crate::db::auth::touch_api_key(&pool_clone, &key_id).await;
        });

        Some(AuthContext {
            user_id: row.name.clone(),
            role,
            permissions,
            auth_method: AuthMethod::ApiKey,
            jti: None,
        })
    }
}
