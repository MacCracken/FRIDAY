//! Notion API client — typed wrapper around the Notion REST API.
//!
//! Credentials: Bearer (integration token).
//! Config field: `token`.
//! API version: 2022-06-28.

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;

use crate::db::integrations;

const NOTION_BASE: &str = "https://api.notion.com/v1";
const NOTION_VERSION: &str = "2022-06-28";

fn base_url() -> String {
    std::env::var("NOTION_API_URL").unwrap_or_else(|_| NOTION_BASE.to_string())
}

// ── Error ────────────────────────────────────────────────────────────────────

/// Errors returned by the Notion client.
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

/// A Notion page object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotionPage {
    pub id: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub properties: serde_json::Value,
    #[serde(default)]
    pub title: Option<String>,
}

/// Search result envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotionSearchResult {
    pub results: Vec<NotionPage>,
    #[serde(default)]
    pub has_more: bool,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

/// A Notion block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotionBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(default)]
    pub content: Option<serde_json::Value>,
    /// Raw block data for unknown types — kept as the original JSON object.
    #[serde(flatten)]
    pub raw: serde_json::Value,
}

/// Block list response.
#[derive(Debug, Deserialize)]
struct NotionBlocksResponse {
    results: Vec<NotionBlock>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    next_cursor: Option<String>,
}

/// Append blocks response.
#[derive(Debug, Deserialize)]
struct NotionAppendBlocksResponse {
    results: Vec<NotionBlock>,
}

/// Database query result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotionQueryResult {
    pub results: Vec<NotionPage>,
    #[serde(default)]
    pub has_more: bool,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

/// A Notion database object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotionDatabase {
    pub id: String,
    #[serde(default)]
    pub title: Vec<serde_json::Value>,
    #[serde(default)]
    pub properties: serde_json::Value,
}

// ── Client ────────────────────────────────────────────────────────────────────

/// Typed Notion API client.
pub struct NotionClient {
    client: reqwest::Client,
    token: String,
}

impl NotionClient {
    /// Create a client from an integration token.
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
            .get("token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                IntegrationError::Credential("Integration missing `token` in config".to_string())
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
            .header(ACCEPT, "application/json")
            .header("Notion-Version", NOTION_VERSION)
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
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .header("Notion-Version", NOTION_VERSION)
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

    async fn patch<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, IntegrationError> {
        let url = format!("{}{path}", base_url());
        let res = self
            .client
            .patch(&url)
            .header(AUTHORIZATION, self.auth_header())
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .header("Notion-Version", NOTION_VERSION)
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

    /// Search across all pages and databases the integration has access to.
    ///
    /// `filter_type` is optional; pass `Some("page")` or `Some("database")`.
    pub async fn search(
        &self,
        query: &str,
        filter_type: Option<&str>,
    ) -> Result<NotionSearchResult, IntegrationError> {
        let mut payload = serde_json::json!({ "query": query });
        if let Some(t) = filter_type {
            payload["filter"] = serde_json::json!({ "value": t, "property": "object" });
        }
        self.post("/search", &payload).await
    }

    /// Get a page by ID.
    pub async fn get_page(&self, id: &str) -> Result<NotionPage, IntegrationError> {
        self.get(&format!("/pages/{id}"), None).await
    }

    /// Get the block children of a page.
    pub async fn get_blocks(&self, page_id: &str) -> Result<Vec<NotionBlock>, IntegrationError> {
        let resp: NotionBlocksResponse = self
            .get(
                &format!("/blocks/{page_id}/children"),
                Some("page_size=100"),
            )
            .await?;
        Ok(resp.results)
    }

    /// Append block children to a page.
    pub async fn append_blocks(
        &self,
        page_id: &str,
        children: &serde_json::Value,
    ) -> Result<(), IntegrationError> {
        let payload = serde_json::json!({ "children": children });
        let _: NotionAppendBlocksResponse = self
            .patch(&format!("/blocks/{page_id}/children"), &payload)
            .await?;
        Ok(())
    }

    /// Query a database.
    pub async fn query_database(
        &self,
        db_id: &str,
        filter: Option<&serde_json::Value>,
        sorts: Option<&serde_json::Value>,
    ) -> Result<NotionQueryResult, IntegrationError> {
        let mut payload = serde_json::json!({});
        if let Some(f) = filter {
            payload["filter"] = f.clone();
        }
        if let Some(s) = sorts {
            payload["sorts"] = s.clone();
        }
        self.post(&format!("/databases/{db_id}/query"), &payload)
            .await
    }

    /// Get a database by ID.
    pub async fn get_database(&self, db_id: &str) -> Result<NotionDatabase, IntegrationError> {
        self.get(&format!("/databases/{db_id}"), None).await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_notion_page() {
        let json = r#"{"id":"abc-123","url":"https://notion.so/abc-123","properties":{}}"#;
        let page: NotionPage = serde_json::from_str(json).unwrap();
        assert_eq!(page.id, "abc-123");
        assert!(page.title.is_none());
    }

    #[test]
    fn deserialize_notion_search_result() {
        let json = r#"{"results":[],"has_more":false,"next_cursor":null}"#;
        let result: NotionSearchResult = serde_json::from_str(json).unwrap();
        assert!(result.results.is_empty());
        assert!(!result.has_more);
    }

    #[test]
    fn deserialize_notion_block() {
        let json = r#"{"id":"block-1","type":"paragraph","content":null,"object":"block"}"#;
        let block: NotionBlock = serde_json::from_str(json).unwrap();
        assert_eq!(block.block_type, "paragraph");
    }

    #[test]
    fn deserialize_notion_database() {
        let json = r#"{"id":"db-1","title":[{"plain_text":"Tasks"}],"properties":{}}"#;
        let db: NotionDatabase = serde_json::from_str(json).unwrap();
        assert_eq!(db.id, "db-1");
    }

    #[test]
    fn base_url_uses_env_override() {
        // SAFETY: single-threaded test; no other threads reading this var.
        unsafe { std::env::remove_var("NOTION_API_URL") };
        assert_eq!(base_url(), NOTION_BASE);
    }
}
