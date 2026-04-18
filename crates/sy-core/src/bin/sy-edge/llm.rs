//! LLM client — multi-provider completion requests (OpenAI, Anthropic, Ollama, OpenRouter).

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ProviderInfo {
    pub name: String,
    pub model: String,
    pub configured: bool,
}

#[derive(Clone)]
pub struct LlmClient {
    providers: Vec<ProviderConfig>,
    http: reqwest::Client,
}

#[derive(Clone)]
struct ProviderConfig {
    name: String,
    api_key: String,
    base_url: String,
    model: String,
}

impl LlmClient {
    pub fn from_env() -> Self {
        let mut providers = Vec::new();

        // OpenAI
        if let Ok(key) = std::env::var("OPENAI_API_KEY") {
            providers.push(ProviderConfig {
                name: "openai".into(),
                api_key: key,
                base_url: std::env::var("OPENAI_BASE_URL")
                    .unwrap_or_else(|_| "https://api.openai.com/v1".into()),
                model: std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".into()),
            });
        }

        // Anthropic
        if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
            providers.push(ProviderConfig {
                name: "anthropic".into(),
                api_key: key,
                base_url: "https://api.anthropic.com/v1".into(),
                model: std::env::var("ANTHROPIC_MODEL")
                    .unwrap_or_else(|_| "claude-sonnet-4-20250514".into()),
            });
        }

        // Ollama
        if let Ok(url) = std::env::var("OLLAMA_URL") {
            providers.push(ProviderConfig {
                name: "ollama".into(),
                api_key: String::new(),
                base_url: url,
                model: std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "llama3.2".into()),
            });
        }

        // OpenRouter
        if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
            providers.push(ProviderConfig {
                name: "openrouter".into(),
                api_key: key,
                base_url: "https://openrouter.ai/api/v1".into(),
                model: std::env::var("OPENROUTER_MODEL")
                    .unwrap_or_else(|_| "anthropic/claude-sonnet-4-20250514".into()),
            });
        }

        Self {
            providers,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
        }
    }

    pub async fn complete(
        &self,
        prompt: &str,
        provider_name: Option<&str>,
        model_override: Option<&str>,
        max_tokens: u32,
    ) -> Result<String, String> {
        let provider = if let Some(name) = provider_name {
            self.providers
                .iter()
                .find(|p| p.name == name)
                .ok_or_else(|| format!("Provider not found: {name}"))?
        } else {
            self.providers
                .first()
                .ok_or("No LLM providers configured")?
        };

        let model = model_override.unwrap_or(&provider.model);

        match provider.name.as_str() {
            "anthropic" => {
                self.complete_anthropic(provider, prompt, model, max_tokens)
                    .await
            }
            "ollama" => self.complete_ollama(provider, prompt, model).await,
            _ => {
                self.complete_openai_compat(provider, prompt, model, max_tokens)
                    .await
            }
        }
    }

    async fn complete_openai_compat(
        &self,
        provider: &ProviderConfig,
        prompt: &str,
        model: &str,
        max_tokens: u32,
    ) -> Result<String, String> {
        let body = serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": prompt }],
            "max_tokens": max_tokens,
        });

        let resp = self
            .http
            .post(format!("{}/chat/completions", provider.base_url))
            .bearer_auth(&provider.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("API error: {text}"));
        }

        let data: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
        Ok(data["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string())
    }

    async fn complete_anthropic(
        &self,
        provider: &ProviderConfig,
        prompt: &str,
        model: &str,
        max_tokens: u32,
    ) -> Result<String, String> {
        let body = serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": prompt }],
            "max_tokens": max_tokens,
        });

        let resp = self
            .http
            .post(format!("{}/messages", provider.base_url))
            .header("x-api-key", &provider.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("API error: {text}"));
        }

        let data: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
        Ok(data["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string())
    }

    async fn complete_ollama(
        &self,
        provider: &ProviderConfig,
        prompt: &str,
        model: &str,
    ) -> Result<String, String> {
        let body = serde_json::json!({
            "model": model,
            "prompt": prompt,
            "stream": false,
        });

        let resp = self
            .http
            .post(format!("{}/api/generate", provider.base_url))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("API error: {text}"));
        }

        let data: serde_json::Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
        Ok(data["response"].as_str().unwrap_or("").to_string())
    }

    #[allow(dead_code)]
    pub fn provider_count(&self) -> usize {
        self.providers.len()
    }

    pub fn list_providers(&self) -> Vec<ProviderInfo> {
        self.providers
            .iter()
            .map(|p| ProviderInfo {
                name: p.name.clone(),
                model: p.model.clone(),
                configured: true,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_providers_returns_vec() {
        // Just verify from_env doesn't panic and returns a valid vec
        let client = LlmClient::from_env();
        let providers = client.list_providers();
        for p in &providers {
            assert!(!p.name.is_empty());
            assert!(p.configured);
        }
    }

    #[test]
    fn from_env_with_openai() {
        unsafe { std::env::set_var("OPENAI_API_KEY", "sk-test-key") };
        let client = LlmClient::from_env();
        assert!(client.provider_count() >= 1);
        let providers = client.list_providers();
        assert!(providers.iter().any(|p| p.name == "openai"));
        unsafe { std::env::remove_var("OPENAI_API_KEY") };
    }

    #[test]
    fn from_env_with_ollama() {
        unsafe { std::env::set_var("OLLAMA_URL", "http://localhost:11434") };
        let client = LlmClient::from_env();
        let providers = client.list_providers();
        assert!(providers.iter().any(|p| p.name == "ollama"));
        unsafe { std::env::remove_var("OLLAMA_URL") };
    }

    #[test]
    fn provider_info_serialization() {
        let info = ProviderInfo {
            name: "openai".into(),
            model: "gpt-4o-mini".into(),
            configured: true,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"name\":\"openai\""));
    }

    #[test]
    fn custom_model_via_env() {
        unsafe { std::env::set_var("OPENAI_API_KEY", "sk-test") };
        unsafe { std::env::set_var("OPENAI_MODEL", "gpt-4o") };
        let client = LlmClient::from_env();
        let providers = client.list_providers();
        let openai = providers.iter().find(|p| p.name == "openai").unwrap();
        assert_eq!(openai.model, "gpt-4o");
        unsafe { std::env::remove_var("OPENAI_API_KEY") };
        unsafe { std::env::remove_var("OPENAI_MODEL") };
    }
}
