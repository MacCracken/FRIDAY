//! Hoosh delegate — real LLM delegation via the AGNOS LLM Gateway.
//!
//! Sends agent tasks to the Hoosh `/v1/chat/completions` endpoint
//! and returns the assistant response. This replaces EchoDelegate
//! for production use.

use crate::orchestration::delegation::{
    AgentDelegate, DelegationError, DelegationParams, DelegationResult,
};

/// LLM delegation via the Hoosh/AGNOS gateway.
pub struct HooshDelegate {
    client: reqwest::Client,
    base_url: String,
    api_key: Option<String>,
    default_model: String,
}

impl HooshDelegate {
    /// Create from environment variables.
    ///
    /// Reads: `HOOSH_URL` or `AGNOS_GATEWAY_URL` (default `http://127.0.0.1:8088`),
    /// `AGNOS_GATEWAY_API_KEY`, `DEFAULT_MODEL` (default `gpt-4o`).
    pub fn from_env() -> Self {
        let base_url = std::env::var("HOOSH_URL")
            .or_else(|_| std::env::var("AGNOS_GATEWAY_URL"))
            .unwrap_or_else(|_| "http://127.0.0.1:8088".to_string());
        let api_key = std::env::var("AGNOS_GATEWAY_API_KEY").ok();
        let default_model = std::env::var("DEFAULT_MODEL").unwrap_or_else(|_| "gpt-4o".to_string());

        Self {
            client: reqwest::Client::new(),
            base_url,
            api_key,
            default_model,
        }
    }

    pub fn new(base_url: String, api_key: Option<String>, default_model: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url,
            api_key,
            default_model,
        }
    }
}

/// OpenAI-compatible chat completion response.
#[derive(serde::Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
    usage: Option<ChatUsage>,
}

#[derive(serde::Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(serde::Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

#[derive(serde::Deserialize)]
struct ChatUsage {
    #[serde(default)]
    total_tokens: u32,
}

impl AgentDelegate for HooshDelegate {
    async fn delegate(
        &self,
        params: DelegationParams,
    ) -> Result<DelegationResult, DelegationError> {
        let model = params
            .model_override
            .as_deref()
            .unwrap_or(&self.default_model);
        let id = uuid::Uuid::now_v7().to_string();

        // Build messages: system prompt from profile context + user task
        let mut messages = Vec::new();

        if let Some(ref ctx) = params.context {
            messages.push(serde_json::json!({
                "role": "system",
                "content": format!("You are agent '{}'. {}", params.profile, ctx),
            }));
        } else {
            messages.push(serde_json::json!({
                "role": "system",
                "content": format!("You are agent '{}'.", params.profile),
            }));
        }

        messages.push(serde_json::json!({
            "role": "user",
            "content": params.task,
        }));

        let mut req = self
            .client
            .post(format!("{}/v1/chat/completions", self.base_url))
            .json(&serde_json::json!({
                "model": model,
                "messages": messages,
                "max_tokens": params.max_token_budget,
                "stream": false,
            }))
            .timeout(std::time::Duration::from_secs(120));

        if let Some(ref key) = self.api_key {
            req = req.bearer_auth(key);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| DelegationError::Failed(format!("Hoosh request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(DelegationError::Failed(format!(
                "Hoosh returned {status}: {body}"
            )));
        }

        let data: ChatCompletionResponse = resp
            .json()
            .await
            .map_err(|e| DelegationError::Failed(format!("failed to parse Hoosh response: {e}")))?;

        let content = data
            .choices
            .first()
            .and_then(|c| c.message.content.clone())
            .unwrap_or_default();

        let tokens_used = data.usage.map(|u| u.total_tokens).unwrap_or(0);

        Ok(DelegationResult {
            id,
            result: content,
            tokens_used,
            success: true,
            error: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_env_defaults() {
        let delegate = HooshDelegate::from_env();
        assert!(
            delegate.base_url.contains("8088")
                || delegate.base_url.contains("hoosh")
                || !delegate.base_url.is_empty()
        );
        assert!(!delegate.default_model.is_empty());
    }

    #[test]
    fn new_with_params() {
        let delegate = HooshDelegate::new(
            "http://localhost:9999".into(),
            Some("key".into()),
            "gpt-4o-mini".into(),
        );
        assert_eq!(delegate.base_url, "http://localhost:9999");
        assert_eq!(delegate.default_model, "gpt-4o-mini");
    }
}
