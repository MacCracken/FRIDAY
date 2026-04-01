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
        // Return zero vectors of the correct dimensionality
        Ok(texts.iter().map(|_| vec![0.0; 384]).collect())
    }

    fn dimensions(&self) -> usize {
        384
    }

    fn name(&self) -> &str {
        "noop"
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
}
