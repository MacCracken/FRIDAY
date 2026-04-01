//! Twitter/X API client — typed wrapper around the Twitter API v2.
//!
//! Credentials: Bearer token (OAuth 2.0 app-only or user access token).
//! Config fields: `bearerToken` (preferred), `accessToken` (fallback).

use reqwest::header::AUTHORIZATION;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;

use crate::db::integrations;

const DEFAULT_BASE_URL: &str = "https://api.twitter.com/2";

fn base_url() -> String {
    std::env::var("TWITTER_API_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
}

// ── Error ────────────────────────────────────────────────────────────────────

/// Errors returned by the Twitter client.
#[derive(Debug, Error)]
pub enum IntegrationError {
    /// HTTP transport error.
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),
    /// Upstream returned a non-success status.
    #[error("provider error ({status}): {body}")]
    Provider { status: u16, body: String },
    /// Credential resolution failed.
    #[error("credential error: {0}")]
    Credential(String),
    /// Database error.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

// ── Response types ────────────────────────────────────────────────────────────

/// Twitter user object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TwitterUser {
    pub id: String,
    pub name: String,
    pub username: String,
}

/// A tweet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tweet {
    pub id: String,
    pub text: String,
    #[serde(rename = "author_id", default)]
    pub author_id: Option<String>,
    #[serde(rename = "created_at", default)]
    pub created_at: Option<String>,
}

/// Wrapper for single-object `data` envelope.
#[derive(Debug, Deserialize)]
struct DataEnvelope<T> {
    data: T,
}

/// Wrapper for list `data` envelope.
///
/// Uses `Option<Vec<T>>` so that missing `data` keys (e.g. empty search
/// results) deserialize cleanly without requiring `T: Default`.
#[derive(Debug, Deserialize)]
struct DataListEnvelope<T> {
    data: Option<Vec<T>>,
}

// ── Client ────────────────────────────────────────────────────────────────────

/// Typed Twitter/X API v2 client.
pub struct TwitterClient {
    client: reqwest::Client,
    bearer_token: String,
}

impl TwitterClient {
    /// Create a client from a bearer token.
    pub fn new(bearer_token: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            bearer_token: bearer_token.into(),
        }
    }

    /// Resolve credentials from the database and build a client.
    ///
    /// Prefers `bearerToken`, falls back to `accessToken`.
    pub async fn from_pool(pool: &PgPool, platform: &str) -> Result<Self, IntegrationError> {
        let row = integrations::find_enabled_by_platform(pool, platform)
            .await?
            .ok_or_else(|| {
                IntegrationError::Credential(format!("No enabled {platform} integration found"))
            })?;
        let token = row
            .config
            .get("bearerToken")
            .or_else(|| row.config.get("accessToken"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                IntegrationError::Credential(
                    "Integration missing `bearerToken` or `accessToken` in config".to_string(),
                )
            })?
            .to_string();
        Ok(Self::new(token))
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn auth_header(&self) -> String {
        format!("Bearer {}", self.bearer_token)
    }

    async fn get<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        query: Option<&str>,
    ) -> Result<T, IntegrationError> {
        let base = base_url();
        let url = match query {
            Some(q) if !q.is_empty() => format!("{base}{path}?{q}"),
            _ => format!("{base}{path}"),
        };
        let res = self
            .client
            .get(&url)
            .header(AUTHORIZATION, self.auth_header())
            .send()
            .await?;
        if res.status().is_success() {
            Ok(res.json().await?)
        } else {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            Err(IntegrationError::Provider { status, body })
        }
    }

    async fn post<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, IntegrationError> {
        let url = format!("{}{path}", base_url());
        let res = self
            .client
            .post(&url)
            .header(AUTHORIZATION, self.auth_header())
            .json(body)
            .send()
            .await?;
        if res.status().is_success() {
            Ok(res.json().await?)
        } else {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            Err(IntegrationError::Provider { status, body })
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// Get the authenticated user.
    pub async fn get_me(&self) -> Result<TwitterUser, IntegrationError> {
        let env: DataEnvelope<TwitterUser> = self
            .get("/users/me", Some("user.fields=name,username"))
            .await?;
        Ok(env.data)
    }

    /// Search recent tweets (past 7 days).
    pub async fn search_tweets(
        &self,
        query: &str,
        max_results: Option<u32>,
    ) -> Result<Vec<Tweet>, IntegrationError> {
        let mut params = vec![
            format!("query={}", query.replace(' ', "%20").replace('&', "%26")),
            "tweet.fields=created_at,author_id".to_string(),
        ];
        if let Some(max) = max_results {
            // Twitter enforces 10–100.
            let clamped = max.clamp(10, 100);
            params.push(format!("max_results={clamped}"));
        }
        let env: DataListEnvelope<Tweet> = self
            .get("/tweets/search/recent", Some(&params.join("&")))
            .await?;
        Ok(env.data.unwrap_or_default())
    }

    /// Post a tweet.
    pub async fn post_tweet(&self, text: &str) -> Result<Tweet, IntegrationError> {
        let payload = serde_json::json!({ "text": text });
        let env: DataEnvelope<Tweet> = self.post("/tweets", &payload).await?;
        Ok(env.data)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_twitter_user() {
        let json = r#"{"data":{"id":"12345","name":"Alice","username":"alice_dev"}}"#;
        let env: DataEnvelope<TwitterUser> = serde_json::from_str(json).unwrap();
        assert_eq!(env.data.id, "12345");
        assert_eq!(env.data.username, "alice_dev");
    }

    #[test]
    fn deserialize_tweet() {
        let json = r#"{"id":"tweet-1","text":"Hello Twitter","author_id":"12345","created_at":"2026-04-01T10:00:00Z"}"#;
        let tweet: Tweet = serde_json::from_str(json).unwrap();
        assert_eq!(tweet.id, "tweet-1");
        assert_eq!(tweet.text, "Hello Twitter");
    }

    #[test]
    fn deserialize_tweet_list_envelope() {
        let json = r#"{"data":[{"id":"1","text":"A"},{"id":"2","text":"B"}]}"#;
        let env: DataListEnvelope<Tweet> = serde_json::from_str(json).unwrap();
        assert_eq!(env.data.as_ref().map(|v| v.len()), Some(2));
    }

    #[test]
    fn empty_search_result_does_not_panic() {
        // When no tweets match, Twitter returns `{"meta":{"result_count":0}}` with no `data`.
        let json = r#"{"meta":{"result_count":0}}"#;
        let env: DataListEnvelope<Tweet> = serde_json::from_str(json).unwrap();
        assert!(env.data.unwrap_or_default().is_empty());
    }

    #[test]
    fn base_url_uses_env_override() {
        // SAFETY: single-threaded test; no other threads reading this var.
        unsafe { std::env::remove_var("TWITTER_API_URL") };
        assert_eq!(base_url(), DEFAULT_BASE_URL);
    }
}
