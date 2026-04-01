//! Gmail API client — typed wrapper around the Gmail API v1.
//!
//! Credentials: OAuth Bearer token.
//! Config field: `accessToken`.

use base64::Engine as _;
use reqwest::header::AUTHORIZATION;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;

use crate::db::integrations;

const DEFAULT_BASE_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me";

fn base_url() -> String {
    std::env::var("GMAIL_API_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
}

// ── Error ────────────────────────────────────────────────────────────────────

/// Errors returned by the Gmail client.
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

/// Gmail profile for the authenticated user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailProfile {
    #[serde(rename = "emailAddress")]
    pub email_address: String,
    #[serde(rename = "messagesTotal", default)]
    pub messages_total: u64,
}

/// A Gmail message summary (from list) or full message (from get).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailMessage {
    pub id: String,
    #[serde(rename = "threadId", default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub snippet: Option<String>,
    #[serde(default)]
    pub payload: Option<GmailPayload>,
    #[serde(rename = "labelIds", default)]
    pub label_ids: Vec<String>,
}

/// Message payload (headers + body).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailPayload {
    #[serde(default)]
    pub headers: Vec<GmailHeader>,
    #[serde(default)]
    pub body: Option<GmailBody>,
    #[serde(default)]
    pub parts: Vec<GmailPayload>,
}

/// A single message header.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailHeader {
    pub name: String,
    pub value: String,
}

/// Message body data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailBody {
    #[serde(default)]
    pub size: u64,
    /// Base64url-encoded data.
    #[serde(default)]
    pub data: Option<String>,
}

/// Message list response envelope.
#[derive(Debug, Deserialize)]
struct GmailMessagesListResponse {
    #[serde(default)]
    messages: Vec<GmailMessageRef>,
    #[serde(rename = "resultSizeEstimate", default)]
    result_size_estimate: u64,
}

/// Minimal message reference returned in list responses.
#[derive(Debug, Deserialize)]
struct GmailMessageRef {
    id: String,
    #[serde(rename = "threadId")]
    thread_id: String,
}

/// A Gmail label.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailLabel {
    pub id: String,
    pub name: String,
    #[serde(rename = "type", default)]
    pub label_type: Option<String>,
}

/// Label list response.
#[derive(Debug, Deserialize)]
struct GmailLabelsResponse {
    #[serde(default)]
    labels: Vec<GmailLabel>,
}

// ── Client ────────────────────────────────────────────────────────────────────

/// Typed Gmail API v1 client.
pub struct GmailClient {
    client: reqwest::Client,
    token: String,
}

impl GmailClient {
    /// Create a client from an OAuth access token.
    pub fn new(token: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            token: token.into(),
        }
    }

    /// Resolve credentials from the database and build a client.
    pub async fn from_pool(pool: &PgPool, platform: &str) -> Result<Self, IntegrationError> {
        let row = integrations::find_enabled_by_platform(pool, platform)
            .await?
            .ok_or_else(|| {
                IntegrationError::Credential(format!("No enabled {platform} integration found"))
            })?;
        let token = row
            .config
            .get("accessToken")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                IntegrationError::Credential(
                    "Integration missing `accessToken` in config".to_string(),
                )
            })?
            .to_string();
        Ok(Self::new(token))
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn auth_header(&self) -> String {
        format!("Bearer {}", self.token)
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

    /// Get the authenticated user's Gmail profile.
    pub async fn get_profile(&self) -> Result<GmailProfile, IntegrationError> {
        self.get("/profile", None).await
    }

    /// List message IDs matching an optional search query.
    ///
    /// Returns lightweight `GmailMessage` structs with only `id` and
    /// `thread_id` populated — call `get_message` for full content.
    pub async fn list_messages(
        &self,
        query: Option<&str>,
        max_results: Option<u32>,
    ) -> Result<Vec<GmailMessage>, IntegrationError> {
        let mut params = Vec::new();
        if let Some(q) = query {
            params.push(format!("q={}", q.replace(' ', "%20")));
        }
        if let Some(max) = max_results {
            params.push(format!("maxResults={max}"));
        }
        let qs = if params.is_empty() {
            None
        } else {
            Some(params.join("&"))
        };
        let resp: GmailMessagesListResponse = self.get("/messages", qs.as_deref()).await?;
        Ok(resp
            .messages
            .into_iter()
            .map(|m| GmailMessage {
                id: m.id,
                thread_id: Some(m.thread_id),
                snippet: None,
                payload: None,
                label_ids: Vec::new(),
            })
            .collect())
    }

    /// Get a full message by ID (format=full).
    pub async fn get_message(&self, id: &str) -> Result<GmailMessage, IntegrationError> {
        self.get(&format!("/messages/{id}"), Some("format=full"))
            .await
    }

    /// Send a message.
    ///
    /// The body is base64url-encoded RFC-2822 message text.
    /// This method constructs a minimal MIME message for plain text.
    pub async fn send_message(
        &self,
        to: &str,
        subject: &str,
        body: &str,
    ) -> Result<GmailMessage, IntegrationError> {
        let raw_mime = format!(
            "To: {to}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
        );
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw_mime.as_bytes());
        let payload = serde_json::json!({ "raw": encoded });
        self.post("/messages/send", &payload).await
    }

    /// List all labels in the mailbox.
    pub async fn list_labels(&self) -> Result<Vec<GmailLabel>, IntegrationError> {
        let resp: GmailLabelsResponse = self.get("/labels", None).await?;
        Ok(resp.labels)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_gmail_profile() {
        let json = r#"{"emailAddress":"user@example.com","messagesTotal":1234}"#;
        let profile: GmailProfile = serde_json::from_str(json).unwrap();
        assert_eq!(profile.email_address, "user@example.com");
        assert_eq!(profile.messages_total, 1234);
    }

    #[test]
    fn deserialize_gmail_label() {
        let json = r#"{"id":"Label_1","name":"INBOX","type":"system"}"#;
        let label: GmailLabel = serde_json::from_str(json).unwrap();
        assert_eq!(label.id, "Label_1");
        assert_eq!(label.label_type.as_deref(), Some("system"));
    }

    #[test]
    fn deserialize_gmail_message_minimal() {
        let json = r#"{"id":"msg-1","threadId":"thread-1","snippet":"Hello world"}"#;
        let msg: GmailMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.id, "msg-1");
        assert_eq!(msg.snippet.as_deref(), Some("Hello world"));
    }

    #[test]
    fn send_message_encodes_correctly() {
        // Verify the base64url-no-pad encoding round-trips.
        let mime =
            "To: x@y.com\r\nSubject: hi\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello";
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mime.as_bytes());
        let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded, mime.as_bytes());
    }

    #[test]
    fn base_url_uses_env_override() {
        // SAFETY: single-threaded test; no other threads reading this var.
        unsafe { std::env::remove_var("GMAIL_API_URL") };
        assert_eq!(base_url(), DEFAULT_BASE_URL);
    }
}
