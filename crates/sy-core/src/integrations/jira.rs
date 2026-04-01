//! Jira API client — typed wrapper around the Jira Cloud REST API v3.
//!
//! Credentials: Basic auth using email + API token (base64-encoded).
//! Config fields: `baseUrl`, `email`, `apiToken`.

use base64::Engine as _;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;

use crate::db::integrations;

// ── Error ────────────────────────────────────────────────────────────────────

/// Errors returned by the Jira client.
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

/// Jira issue summary (as returned in search / get).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraIssue {
    pub key: String,
    #[serde(default)]
    pub fields: JiraFields,
}

/// Fields block inside a Jira issue.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct JiraFields {
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub status: Option<JiraStatus>,
    #[serde(default)]
    pub assignee: Option<JiraUser>,
    #[serde(default)]
    pub description: Option<serde_json::Value>,
}

/// Jira status object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraStatus {
    pub name: String,
}

/// Jira user object (assignee / reporter / comment author).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraUser {
    #[serde(rename = "displayName", default)]
    pub display_name: String,
    #[serde(rename = "emailAddress", default)]
    pub email_address: Option<String>,
}

/// Response from the Jira search endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraSearchResult {
    pub issues: Vec<JiraIssue>,
    pub total: u64,
    #[serde(rename = "startAt", default)]
    pub start_at: u64,
    #[serde(rename = "maxResults", default)]
    pub max_results: u64,
}

/// Jira project summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraProject {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub id: String,
}

/// Jira workflow transition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraTransition {
    pub id: String,
    pub name: String,
}

/// Container for transition list response.
#[derive(Debug, Deserialize)]
struct JiraTransitionsResponse {
    transitions: Vec<JiraTransition>,
}

/// Jira comment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraComment {
    pub id: String,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
    #[serde(default)]
    pub author: Option<JiraUser>,
}

/// Container for comment list response.
#[derive(Debug, Deserialize)]
struct JiraCommentsResponse {
    comments: Vec<JiraComment>,
}

/// Container for project list response.
#[derive(Debug, Deserialize)]
struct JiraProjectsResponse(Vec<JiraProject>);

// ── Client ────────────────────────────────────────────────────────────────────

/// Typed Jira Cloud API client.
pub struct JiraClient {
    client: reqwest::Client,
    base_url: String,
    email: String,
    api_token: String,
}

impl JiraClient {
    /// Create a client from explicit credentials.
    ///
    /// `base_url` should be the Atlassian domain root,
    /// e.g. `https://yourcompany.atlassian.net`.
    pub fn new(
        base_url: impl Into<String>,
        email: impl Into<String>,
        api_token: impl Into<String>,
    ) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            email: email.into(),
            api_token: api_token.into(),
        }
    }

    /// Resolve credentials from the database and build a client.
    pub async fn from_pool(pool: &PgPool, platform: &str) -> Result<Self, IntegrationError> {
        let row = integrations::find_enabled_by_platform(pool, platform)
            .await?
            .ok_or_else(|| {
                IntegrationError::Credential(format!("No enabled {platform} integration found"))
            })?;
        let cfg = &row.config;
        let get = |field: &str| {
            cfg.get(field)
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| {
                    IntegrationError::Credential(format!("Integration missing `{field}` in config"))
                })
        };
        let base_url = get("baseUrl")?;
        let email = get("email")?;
        let api_token = get("apiToken")?;
        Ok(Self::new(base_url, email, api_token))
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn basic_auth_header(&self) -> String {
        let encoded = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:{}", self.email, self.api_token));
        format!("Basic {encoded}")
    }

    async fn get<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        query: Option<&str>,
    ) -> Result<T, IntegrationError> {
        let url = match query {
            Some(q) if !q.is_empty() => format!("{}{path}?{q}", self.base_url),
            _ => format!("{}{path}", self.base_url),
        };
        let res = self
            .client
            .get(&url)
            .header(AUTHORIZATION, self.basic_auth_header())
            .header(ACCEPT, "application/json")
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
        let url = format!("{}{path}", self.base_url);
        let res = self
            .client
            .post(&url)
            .header(AUTHORIZATION, self.basic_auth_header())
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
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

    async fn put_empty(&self, path: &str, body: &impl Serialize) -> Result<(), IntegrationError> {
        let url = format!("{}{path}", self.base_url);
        let res = self
            .client
            .put(&url)
            .header(AUTHORIZATION, self.basic_auth_header())
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .json(body)
            .send()
            .await?;
        if res.status().is_success() {
            Ok(())
        } else {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            Err(IntegrationError::Provider { status, body })
        }
    }

    async fn post_empty(&self, path: &str, body: &impl Serialize) -> Result<(), IntegrationError> {
        let url = format!("{}{path}", self.base_url);
        let res = self
            .client
            .post(&url)
            .header(AUTHORIZATION, self.basic_auth_header())
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .json(body)
            .send()
            .await?;
        if res.status().is_success() {
            Ok(())
        } else {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            Err(IntegrationError::Provider { status, body })
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// Search issues using JQL.
    pub async fn search(
        &self,
        jql: &str,
        max_results: u32,
    ) -> Result<JiraSearchResult, IntegrationError> {
        let payload = serde_json::json!({
            "jql": jql,
            "maxResults": max_results,
            "fields": ["summary", "status", "assignee", "description"]
        });
        self.post("/rest/api/3/search", &payload).await
    }

    /// Get a single issue by key (e.g. `PROJ-123`).
    pub async fn get_issue(&self, key: &str) -> Result<JiraIssue, IntegrationError> {
        self.get(
            &format!("/rest/api/3/issue/{key}"),
            Some("fields=summary,status,assignee,description"),
        )
        .await
    }

    /// Update issue fields.
    pub async fn update_issue(
        &self,
        key: &str,
        fields: &serde_json::Value,
    ) -> Result<(), IntegrationError> {
        let payload = serde_json::json!({ "fields": fields });
        self.put_empty(&format!("/rest/api/3/issue/{key}"), &payload)
            .await
    }

    /// List all visible projects.
    pub async fn list_projects(&self) -> Result<Vec<JiraProject>, IntegrationError> {
        self.get("/rest/api/3/project", None).await
    }

    /// List available transitions for an issue.
    pub async fn list_transitions(
        &self,
        key: &str,
    ) -> Result<Vec<JiraTransition>, IntegrationError> {
        let resp: JiraTransitionsResponse = self
            .get(&format!("/rest/api/3/issue/{key}/transitions"), None)
            .await?;
        Ok(resp.transitions)
    }

    /// Perform a workflow transition on an issue.
    pub async fn do_transition(
        &self,
        key: &str,
        transition_id: &str,
    ) -> Result<(), IntegrationError> {
        let payload = serde_json::json!({
            "transition": { "id": transition_id }
        });
        self.post_empty(&format!("/rest/api/3/issue/{key}/transitions"), &payload)
            .await
    }

    /// List comments on an issue.
    pub async fn list_comments(&self, key: &str) -> Result<Vec<JiraComment>, IntegrationError> {
        let resp: JiraCommentsResponse = self
            .get(&format!("/rest/api/3/issue/{key}/comment"), None)
            .await?;
        Ok(resp.comments)
    }

    /// Add a comment to an issue (plain text body).
    pub async fn add_comment(
        &self,
        key: &str,
        body: &str,
    ) -> Result<JiraComment, IntegrationError> {
        // Jira Cloud v3 uses Atlassian Document Format for body.
        let payload = serde_json::json!({
            "body": {
                "type": "doc",
                "version": 1,
                "content": [{
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": body }]
                }]
            }
        });
        self.post(&format!("/rest/api/3/issue/{key}/comment"), &payload)
            .await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_jira_issue() {
        let json = r#"{"key":"PROJ-1","fields":{"summary":"Fix login bug","status":{"name":"In Progress"},"assignee":{"displayName":"Alice","emailAddress":"alice@example.com"},"description":null}}"#;
        let issue: JiraIssue = serde_json::from_str(json).unwrap();
        assert_eq!(issue.key, "PROJ-1");
        assert_eq!(issue.fields.summary, "Fix login bug");
        assert_eq!(
            issue.fields.status.as_ref().map(|s| s.name.as_str()),
            Some("In Progress")
        );
    }

    #[test]
    fn deserialize_jira_search_result() {
        let json = r#"{"issues":[],"total":0,"startAt":0,"maxResults":50}"#;
        let result: JiraSearchResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.total, 0);
        assert!(result.issues.is_empty());
    }

    #[test]
    fn deserialize_jira_project() {
        let json = r#"{"key":"PROJ","name":"My Project","id":"10000"}"#;
        let project: JiraProject = serde_json::from_str(json).unwrap();
        assert_eq!(project.key, "PROJ");
        assert_eq!(project.name, "My Project");
    }

    #[test]
    fn deserialize_jira_transition() {
        let json = r#"{"id":"21","name":"In Progress"}"#;
        let t: JiraTransition = serde_json::from_str(json).unwrap();
        assert_eq!(t.id, "21");
        assert_eq!(t.name, "In Progress");
    }

    #[test]
    fn basic_auth_encoding() {
        let client = JiraClient::new("https://test.atlassian.net", "user@example.com", "secret");
        let header = client.basic_auth_header();
        assert!(header.starts_with("Basic "));
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(header.trim_start_matches("Basic "))
            .unwrap();
        assert_eq!(decoded, b"user@example.com:secret");
    }
}
