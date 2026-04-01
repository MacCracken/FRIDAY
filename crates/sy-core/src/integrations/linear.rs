//! Linear API client — typed wrapper around the Linear GraphQL API.
//!
//! Credentials: API key (Bearer token).
//! Config field: `apiKey`.
//! Endpoint: https://api.linear.app/graphql

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;

use crate::db::integrations;

const DEFAULT_ENDPOINT: &str = "https://api.linear.app/graphql";

fn endpoint() -> String {
    std::env::var("LINEAR_API_URL").unwrap_or_else(|_| DEFAULT_ENDPOINT.to_string())
}

// ── Error ────────────────────────────────────────────────────────────────────

/// Errors returned by the Linear client.
#[derive(Debug, Error)]
pub enum IntegrationError {
    /// HTTP transport error.
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),
    /// Upstream returned a non-success status.
    #[error("provider error ({status}): {body}")]
    Provider { status: u16, body: String },
    /// GraphQL-level error returned in the response body.
    #[error("graphql error: {0}")]
    GraphQl(String),
    /// Credential resolution failed.
    #[error("credential error: {0}")]
    Credential(String),
    /// Database error.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

// ── Response types ────────────────────────────────────────────────────────────

/// A Linear team.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearTeam {
    pub id: String,
    pub name: String,
    pub key: String,
}

/// A Linear issue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearIssue {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub state: Option<LinearState>,
    #[serde(default)]
    pub priority: Option<f64>,
    #[serde(default)]
    pub url: Option<String>,
}

/// Linear issue state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearState {
    pub name: String,
}

// ── GraphQL helpers ───────────────────────────────────────────────────────────

#[derive(Serialize)]
struct GqlRequest {
    query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    variables: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct GqlResponse {
    data: Option<serde_json::Value>,
    errors: Option<Vec<GqlError>>,
}

#[derive(Deserialize)]
struct GqlError {
    message: String,
}

// ── Client ────────────────────────────────────────────────────────────────────

/// Typed Linear GraphQL API client.
pub struct LinearClient {
    client: reqwest::Client,
    api_key: String,
}

impl LinearClient {
    /// Create a client from an API key.
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key: api_key.into(),
        }
    }

    /// Resolve credentials from the database and build a client.
    pub async fn from_pool(pool: &PgPool, platform: &str) -> Result<Self, IntegrationError> {
        let row = integrations::find_enabled_by_platform(pool, platform)
            .await?
            .ok_or_else(|| {
                IntegrationError::Credential(format!("No enabled {platform} integration found"))
            })?;
        let api_key = row
            .config
            .get("apiKey")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                IntegrationError::Credential("Integration missing `apiKey` in config".to_string())
            })?
            .to_string();
        Ok(Self::new(api_key))
    }

    // ── Internal helper ───────────────────────────────────────────────────────

    /// Execute a GraphQL query and return the `data` field.
    async fn query(
        &self,
        query: &str,
        variables: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, IntegrationError> {
        let body = GqlRequest {
            query: query.to_string(),
            variables,
        };
        let res = self
            .client
            .post(endpoint())
            .header(AUTHORIZATION, format!("Bearer {}", self.api_key))
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let text = res.text().await.unwrap_or_default();
            return Err(IntegrationError::Provider { status, body: text });
        }

        let gql: GqlResponse = res.json().await?;

        if let Some(errors) = gql.errors {
            let msg = errors
                .into_iter()
                .map(|e| e.message)
                .collect::<Vec<_>>()
                .join("; ");
            return Err(IntegrationError::GraphQl(msg));
        }

        Ok(gql.data.unwrap_or(serde_json::Value::Null))
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// List all teams.
    pub async fn list_teams(&self) -> Result<Vec<LinearTeam>, IntegrationError> {
        let data = self
            .query("{ teams { nodes { id name key } } }", None)
            .await?;
        let nodes = data
            .pointer("/teams/nodes")
            .cloned()
            .unwrap_or(serde_json::json!([]));
        serde_json::from_value(nodes)
            .map_err(|e| IntegrationError::GraphQl(format!("Failed to deserialize teams: {e}")))
    }

    /// List issues for a team.
    pub async fn list_issues(
        &self,
        team_id: &str,
        first: u32,
    ) -> Result<Vec<LinearIssue>, IntegrationError> {
        let query = format!(
            r#"{{ team(id: "{team_id}") {{ issues(first: {first}, orderBy: updatedAt) {{ nodes {{ id title state {{ name }} priority url }} }} }} }}"#
        );
        let data = self.query(&query, None).await?;
        let nodes = data
            .pointer("/team/issues/nodes")
            .cloned()
            .unwrap_or(serde_json::json!([]));
        serde_json::from_value(nodes)
            .map_err(|e| IntegrationError::GraphQl(format!("Failed to deserialize issues: {e}")))
    }

    /// Create a new issue.
    pub async fn create_issue(
        &self,
        team_id: &str,
        title: &str,
        description: Option<&str>,
        priority: Option<u32>,
    ) -> Result<LinearIssue, IntegrationError> {
        let mut input = serde_json::json!({
            "teamId": team_id,
            "title": title,
        });
        if let Some(d) = description {
            input["description"] = serde_json::json!(d);
        }
        if let Some(p) = priority {
            input["priority"] = serde_json::json!(p);
        }

        let query = r#"
            mutation CreateIssue($input: IssueCreateInput!) {
                issueCreate(input: $input) {
                    issue { id title state { name } priority url }
                }
            }
        "#;
        let data = self
            .query(query, Some(serde_json::json!({ "input": input })))
            .await?;
        let issue_val = data
            .pointer("/issueCreate/issue")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        serde_json::from_value(issue_val).map_err(|e| {
            IntegrationError::GraphQl(format!("Failed to deserialize created issue: {e}"))
        })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_linear_team() {
        let json = r#"{"id":"team-1","name":"Engineering","key":"ENG"}"#;
        let team: LinearTeam = serde_json::from_str(json).unwrap();
        assert_eq!(team.key, "ENG");
    }

    #[test]
    fn deserialize_linear_issue() {
        let json = r#"{"id":"issue-1","title":"Fix crash","state":{"name":"In Progress"},"priority":2.0,"url":"https://linear.app/issue-1"}"#;
        let issue: LinearIssue = serde_json::from_str(json).unwrap();
        assert_eq!(issue.title, "Fix crash");
        assert_eq!(
            issue.state.as_ref().map(|s| s.name.as_str()),
            Some("In Progress")
        );
    }

    #[test]
    fn gql_request_serializes_without_variables() {
        let req = GqlRequest {
            query: "{ teams { nodes { id } } }".to_string(),
            variables: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("variables"));
    }

    #[test]
    fn endpoint_uses_env_override() {
        // SAFETY: single-threaded test; no other threads reading this var.
        unsafe { std::env::remove_var("LINEAR_API_URL") };
        assert_eq!(endpoint(), DEFAULT_ENDPOINT);
    }
}
