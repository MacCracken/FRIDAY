//! Application state shared across all handlers via axum State extractor.

use sqlx::PgPool;
use std::sync::Arc;
use std::time::Instant;
use sy_types::CoreConfig;
use tokio::sync::broadcast;

use crate::auth::jwt::JwtConfig;
use crate::auth::middleware::AuthContext;
use crate::brain::embedding::{
    EmbeddingProvider, NoopEmbeddingProvider, OllamaEmbeddingProvider, OpenAiEmbeddingProvider,
};
use crate::brain::manager::{BrainConfig, BrainManager};
use crate::brain::vector::InMemoryVectorStore;
use crate::integrations::github::GitHubClient;
use crate::integrations::gmail::GmailClient;
use crate::integrations::google_calendar::GoogleCalendarClient;
use crate::integrations::jira::JiraClient;
use crate::integrations::linear::LinearClient;
use crate::integrations::notion::NotionClient;
use crate::integrations::todoist::TodoistClient;
use crate::integrations::twitter::TwitterClient;

/// Type-erased brain manager for use in AppState.
/// Uses dynamic dispatch so AppState doesn't need generics.
pub type DynBrainManager = BrainManager<DynEmbeddingProvider, InMemoryVectorStore>;

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
        let brain = BrainManager::new(
            pool.clone(),
            "default".to_string(),
            BrainConfig::default(),
            embedding,
            InMemoryVectorStore::new(),
        );

        let inner = Arc::get_mut(&mut self.inner).unwrap();
        inner.db_pool = Some(pool);
        inner.brain = Some(Arc::new(brain));
        self
    }

    pub fn db(&self) -> Option<&PgPool> {
        self.inner.db_pool.as_ref()
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
