//! Embedding provider trait — provider-agnostic text embedding interface.
//!
//! Implementations live behind this trait: OpenAI, Ollama, local ONNX, Hoosh.
//! The brain manager uses this interface to embed text for vector search
//! without knowing which provider is active.

use std::future::Future;

/// Result from an embedding operation.
pub type EmbedResult = Result<Vec<Vec<f32>>, EmbedError>;

/// Error from an embedding operation.
#[derive(Debug, thiserror::Error)]
pub enum EmbedError {
    #[error("embedding provider error: {0}")]
    Provider(String),
    #[error("rate limited — retry after {retry_after_ms}ms")]
    RateLimited { retry_after_ms: u64 },
    #[error("input too long: {len} chars (max {max})")]
    InputTooLong { len: usize, max: usize },
}

/// Provider-agnostic embedding interface.
///
/// All embedding providers implement this trait. The brain manager
/// calls `embed()` with batches of text and receives vectors.
pub trait EmbeddingProvider: Send + Sync {
    /// Embed a batch of texts into vectors.
    ///
    /// Returns one vector per input text. Vector dimensions must be
    /// consistent across calls (see `dimensions()`).
    fn embed(&self, texts: &[String]) -> impl Future<Output = EmbedResult> + Send;

    /// Number of dimensions in the embedding vectors.
    fn dimensions(&self) -> usize;

    /// Provider name for logging and metrics.
    fn name(&self) -> &str;
}

/// A no-op embedding provider for testing or when no provider is configured.
pub struct NoopEmbeddingProvider;

impl EmbeddingProvider for NoopEmbeddingProvider {
    async fn embed(&self, texts: &[String]) -> EmbedResult {
        Ok(texts.iter().map(|_| vec![0.0; 384]).collect())
    }

    fn dimensions(&self) -> usize {
        384
    }

    fn name(&self) -> &str {
        "noop"
    }
}

// ── OpenAI-compatible embedding provider ────────────────────────────────
//
// Works with OpenAI, Gemini, Hoosh (AGNOS gateway), and any provider that
// implements the /v1/embeddings endpoint.

/// Configuration for an OpenAI-compatible embedding provider.
pub struct OpenAiEmbeddingConfig {
    /// Base URL (e.g., "https://api.openai.com/v1" or "http://127.0.0.1:8088").
    pub base_url: String,
    /// Model name (e.g., "text-embedding-3-small").
    pub model: String,
    /// Optional API key for authentication.
    pub api_key: Option<String>,
    /// Provider name for logging.
    pub provider_name: String,
}

impl Default for OpenAiEmbeddingConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            model: "text-embedding-3-small".to_string(),
            api_key: None,
            provider_name: "openai".to_string(),
        }
    }
}

/// Embedding provider using the OpenAI /v1/embeddings API format.
///
/// Supports: OpenAI, Gemini, Hoosh (AGNOS LLM Gateway), and any compatible endpoint.
pub struct OpenAiEmbeddingProvider {
    client: reqwest::Client,
    config: OpenAiEmbeddingConfig,
}

impl OpenAiEmbeddingProvider {
    pub fn new(config: OpenAiEmbeddingConfig) -> Self {
        Self {
            client: reqwest::Client::new(),
            config,
        }
    }

    /// Create a provider pointing to the Hoosh/AGNOS gateway.
    pub fn hoosh(base_url: Option<&str>, api_key: Option<String>) -> Self {
        Self::new(OpenAiEmbeddingConfig {
            base_url: base_url.unwrap_or("http://127.0.0.1:8088").to_string(),
            model: "text-embedding-3-small".to_string(),
            api_key,
            provider_name: "hoosh".to_string(),
        })
    }

    /// Create a provider pointing to OpenAI.
    pub fn openai(api_key: &str, model: Option<&str>) -> Self {
        Self::new(OpenAiEmbeddingConfig {
            api_key: Some(api_key.to_string()),
            model: model.unwrap_or("text-embedding-3-small").to_string(),
            ..Default::default()
        })
    }
}

/// OpenAI embedding response shape.
#[derive(serde::Deserialize)]
struct OpenAiEmbeddingResponse {
    data: Vec<OpenAiEmbeddingData>,
}

#[derive(serde::Deserialize)]
struct OpenAiEmbeddingData {
    embedding: Vec<f32>,
    index: usize,
}

impl EmbeddingProvider for OpenAiEmbeddingProvider {
    async fn embed(&self, texts: &[String]) -> EmbedResult {
        let url = format!("{}/embeddings", self.config.base_url);

        let mut req = self
            .client
            .post(&url)
            .json(&serde_json::json!({
                "input": texts,
                "model": self.config.model,
            }))
            .timeout(std::time::Duration::from_secs(60));

        if let Some(ref key) = self.config.api_key {
            req = req.bearer_auth(key);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| EmbedError::Provider(e.to_string()))?;

        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(5000);
            return Err(EmbedError::RateLimited {
                retry_after_ms: retry_after * 1000,
            });
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(EmbedError::Provider(format!(
                "{} embedding API error {status}: {body}",
                self.config.provider_name
            )));
        }

        let data: OpenAiEmbeddingResponse = resp
            .json()
            .await
            .map_err(|e| EmbedError::Provider(format!("failed to parse response: {e}")))?;

        // Sort by index to preserve input order
        let mut items = data.data;
        items.sort_by_key(|d| d.index);

        Ok(items.into_iter().map(|d| d.embedding).collect())
    }

    fn dimensions(&self) -> usize {
        match self.config.model.as_str() {
            "text-embedding-3-large" => 3072,
            "text-embedding-3-small" | "text-embedding-ada-002" => 1536,
            "models/text-embedding-004" => 768,
            _ => 1536,
        }
    }

    fn name(&self) -> &str {
        &self.config.provider_name
    }
}

// ── Ollama embedding provider ───────────────────────────────────────────
//
// Uses Ollama's /api/embed endpoint (v0.1.26+).

/// Configuration for the Ollama embedding provider.
pub struct OllamaEmbeddingConfig {
    /// Ollama server URL. Default: "http://localhost:11434".
    pub base_url: String,
    /// Model name. Default: "nomic-embed-text".
    pub model: String,
}

impl Default for OllamaEmbeddingConfig {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:11434".to_string(),
            model: "nomic-embed-text".to_string(),
        }
    }
}

/// Embedding provider using Ollama's local embedding API.
pub struct OllamaEmbeddingProvider {
    client: reqwest::Client,
    config: OllamaEmbeddingConfig,
}

impl OllamaEmbeddingProvider {
    pub fn new(config: OllamaEmbeddingConfig) -> Self {
        Self {
            client: reqwest::Client::new(),
            config,
        }
    }
}

/// Ollama embedding response shape.
#[derive(serde::Deserialize)]
struct OllamaEmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

impl EmbeddingProvider for OllamaEmbeddingProvider {
    async fn embed(&self, texts: &[String]) -> EmbedResult {
        let url = format!("{}/api/embed", self.config.base_url);

        let resp = self
            .client
            .post(&url)
            .json(&serde_json::json!({
                "model": self.config.model,
                "input": texts,
            }))
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| EmbedError::Provider(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(EmbedError::Provider(format!(
                "Ollama embedding error {status}: {body}"
            )));
        }

        let data: OllamaEmbedResponse = resp
            .json()
            .await
            .map_err(|e| EmbedError::Provider(format!("failed to parse Ollama response: {e}")))?;

        Ok(data.embeddings)
    }

    fn dimensions(&self) -> usize {
        match self.config.model.as_str() {
            "nomic-embed-text" | "nomic-embed-text:latest" => 768,
            "mxbai-embed-large" | "mxbai-embed-large:latest" => 1024,
            "all-minilm" | "all-minilm:latest" => 384,
            "snowflake-arctic-embed" | "bge-m3" => 1024,
            _ => 768,
        }
    }

    fn name(&self) -> &str {
        "ollama"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn noop_returns_correct_dimensions() {
        let provider = NoopEmbeddingProvider;
        let result = provider.embed(&["hello".into()]).await.unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].len(), 384);
    }

    #[tokio::test]
    async fn noop_handles_batch() {
        let provider = NoopEmbeddingProvider;
        let texts: Vec<String> = (0..10).map(|i| format!("text {i}")).collect();
        let result = provider.embed(&texts).await.unwrap();
        assert_eq!(result.len(), 10);
    }

    #[test]
    fn openai_dimensions() {
        let p = OpenAiEmbeddingProvider::openai("test", None);
        assert_eq!(p.dimensions(), 1536);

        let p = OpenAiEmbeddingProvider::new(OpenAiEmbeddingConfig {
            model: "text-embedding-3-large".to_string(),
            ..Default::default()
        });
        assert_eq!(p.dimensions(), 3072);
    }

    #[test]
    fn ollama_dimensions() {
        let p = OllamaEmbeddingProvider::new(OllamaEmbeddingConfig::default());
        assert_eq!(p.dimensions(), 768);

        let p = OllamaEmbeddingProvider::new(OllamaEmbeddingConfig {
            model: "all-minilm".to_string(),
            ..Default::default()
        });
        assert_eq!(p.dimensions(), 384);
    }

    #[test]
    fn hoosh_defaults() {
        let p = OpenAiEmbeddingProvider::hoosh(None, None);
        assert_eq!(p.name(), "hoosh");
        assert_eq!(p.dimensions(), 1536);
    }

    #[test]
    fn provider_names() {
        assert_eq!(NoopEmbeddingProvider.name(), "noop");
        assert_eq!(
            OllamaEmbeddingProvider::new(Default::default()).name(),
            "ollama"
        );
        assert_eq!(OpenAiEmbeddingProvider::openai("k", None).name(), "openai");
        assert_eq!(OpenAiEmbeddingProvider::hoosh(None, None).name(), "hoosh");
    }
}
