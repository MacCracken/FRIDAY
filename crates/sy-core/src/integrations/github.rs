//! GitHub API client — typed wrapper around the GitHub REST API v3.
//!
//! Credentials: Bearer token (personal access token or OAuth token).
//! Config field: `token`.

use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;

use crate::db::integrations;

const DEFAULT_BASE_URL: &str = "https://api.github.com";

fn base_url() -> String {
    std::env::var("GITHUB_API_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
}

// ── Error ────────────────────────────────────────────────────────────────────

/// Errors returned by the GitHub client.
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

/// GitHub user object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubUser {
    pub login: String,
    #[serde(default)]
    pub name: Option<String>,
    pub avatar_url: String,
    #[serde(default)]
    pub email: Option<String>,
}

/// GitHub repository object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRepo {
    pub full_name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub default_branch: String,
    pub private: bool,
    pub html_url: String,
}

/// GitHub issue object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubIssue {
    pub number: u64,
    pub title: String,
    pub state: String,
    #[serde(default)]
    pub body: Option<String>,
    pub html_url: String,
}

/// GitHub pull request object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubPull {
    pub number: u64,
    pub title: String,
    pub state: String,
    #[serde(rename = "head")]
    pub head_ref: GitHubRef,
    #[serde(rename = "base")]
    pub base_ref: GitHubRef,
    pub html_url: String,
}

/// Ref object used inside pull request head/base.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRef {
    #[serde(rename = "ref")]
    pub ref_name: String,
}

/// GitHub branch object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubBranch {
    pub name: String,
    #[serde(default)]
    pub protected: bool,
}

/// GitHub commit object (list view).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubCommit {
    pub sha: String,
    #[serde(default)]
    pub commit: GitHubCommitDetail,
}

/// Inner commit detail (message + author).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GitHubCommitDetail {
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub author: GitHubCommitAuthor,
}

/// Commit author detail.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GitHubCommitAuthor {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub date: String,
}

// ── Request bodies ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct CreateIssueBody<'a> {
    title: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<&'a str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    labels: Vec<String>,
}

#[derive(Serialize)]
struct CreatePullBody<'a> {
    title: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<&'a str>,
    head: &'a str,
    base: &'a str,
}

// ── Client ────────────────────────────────────────────────────────────────────

/// Typed GitHub API client.
pub struct GitHubClient {
    client: reqwest::Client,
    token: String,
    base_url: String,
}

impl GitHubClient {
    /// Create a client from a personal access token or OAuth token.
    pub fn new(token: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            token: token.into(),
            base_url: base_url(),
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

    // ── Internal helper ───────────────────────────────────────────────────────

    fn auth_header(&self) -> String {
        format!("Bearer {}", self.token)
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
            .header(AUTHORIZATION, self.auth_header())
            .header(ACCEPT, "application/vnd.github+json")
            .header(USER_AGENT, "SecureYeoman/1.0")
            .header("X-GitHub-Api-Version", "2022-11-28")
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
            .header(AUTHORIZATION, self.auth_header())
            .header(ACCEPT, "application/vnd.github+json")
            .header(USER_AGENT, "SecureYeoman/1.0")
            .header("X-GitHub-Api-Version", "2022-11-28")
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
    pub async fn get_user(&self) -> Result<GitHubUser, IntegrationError> {
        self.get("/user", None).await
    }

    /// List repositories for the authenticated user.
    pub async fn list_repos(
        &self,
        page: u32,
        per_page: u32,
    ) -> Result<Vec<GitHubRepo>, IntegrationError> {
        let q = format!("per_page={per_page}&page={page}&sort=updated");
        self.get("/user/repos", Some(&q)).await
    }

    /// Get a single repository.
    pub async fn get_repo(&self, owner: &str, repo: &str) -> Result<GitHubRepo, IntegrationError> {
        self.get(&format!("/repos/{owner}/{repo}"), None).await
    }

    /// List issues for a repository.
    pub async fn list_issues(
        &self,
        owner: &str,
        repo: &str,
        state: &str,
        page: u32,
    ) -> Result<Vec<GitHubIssue>, IntegrationError> {
        let q = format!("state={state}&page={page}&per_page=30");
        self.get(&format!("/repos/{owner}/{repo}/issues"), Some(&q))
            .await
    }

    /// Create an issue in a repository.
    pub async fn create_issue(
        &self,
        owner: &str,
        repo: &str,
        title: &str,
        body: Option<&str>,
        labels: Vec<String>,
    ) -> Result<GitHubIssue, IntegrationError> {
        let payload = CreateIssueBody {
            title,
            body,
            labels,
        };
        self.post(&format!("/repos/{owner}/{repo}/issues"), &payload)
            .await
    }

    /// List pull requests for a repository.
    pub async fn list_pulls(
        &self,
        owner: &str,
        repo: &str,
        state: &str,
        page: u32,
    ) -> Result<Vec<GitHubPull>, IntegrationError> {
        let q = format!("state={state}&page={page}&per_page=30");
        self.get(&format!("/repos/{owner}/{repo}/pulls"), Some(&q))
            .await
    }

    /// Create a pull request.
    pub async fn create_pull(
        &self,
        owner: &str,
        repo: &str,
        title: &str,
        body: Option<&str>,
        head: &str,
        base: &str,
    ) -> Result<GitHubPull, IntegrationError> {
        let payload = CreatePullBody {
            title,
            body,
            head,
            base,
        };
        self.post(&format!("/repos/{owner}/{repo}/pulls"), &payload)
            .await
    }

    /// List branches for a repository.
    pub async fn list_branches(
        &self,
        owner: &str,
        repo: &str,
    ) -> Result<Vec<GitHubBranch>, IntegrationError> {
        self.get(
            &format!("/repos/{owner}/{repo}/branches"),
            Some("per_page=100"),
        )
        .await
    }

    /// List commits for a repository.
    pub async fn list_commits(
        &self,
        owner: &str,
        repo: &str,
        sha: Option<&str>,
        page: u32,
    ) -> Result<Vec<GitHubCommit>, IntegrationError> {
        let mut parts = vec![format!("page={page}"), "per_page=30".to_string()];
        if let Some(s) = sha {
            parts.push(format!("sha={s}"));
        }
        self.get(
            &format!("/repos/{owner}/{repo}/commits"),
            Some(&parts.join("&")),
        )
        .await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_github_user() {
        let json = r#"{"login":"octocat","name":"The Octocat","avatar_url":"https://github.com/images/error/octocat_happy.gif","email":null}"#;
        let user: GitHubUser = serde_json::from_str(json).unwrap();
        assert_eq!(user.login, "octocat");
        assert!(user.email.is_none());
    }

    #[test]
    fn deserialize_github_repo() {
        let json = r#"{"full_name":"octocat/Hello-World","description":"A test repo","default_branch":"main","private":false,"html_url":"https://github.com/octocat/Hello-World"}"#;
        let repo: GitHubRepo = serde_json::from_str(json).unwrap();
        assert_eq!(repo.full_name, "octocat/Hello-World");
        assert!(!repo.private);
    }

    #[test]
    fn deserialize_github_issue() {
        let json = r#"{"number":1,"title":"Found a bug","state":"open","body":"I'm having trouble.","html_url":"https://github.com/octocat/Hello-World/issues/1"}"#;
        let issue: GitHubIssue = serde_json::from_str(json).unwrap();
        assert_eq!(issue.number, 1);
        assert_eq!(issue.state, "open");
    }

    #[test]
    fn deserialize_github_pull() {
        let json = r#"{"number":42,"title":"Add feature","state":"open","head":{"ref":"feature-branch"},"base":{"ref":"main"},"html_url":"https://github.com/octocat/Hello-World/pull/42"}"#;
        let pull: GitHubPull = serde_json::from_str(json).unwrap();
        assert_eq!(pull.head_ref.ref_name, "feature-branch");
        assert_eq!(pull.base_ref.ref_name, "main");
    }

    #[test]
    fn deserialize_github_branch() {
        let json = r#"{"name":"main","protected":true}"#;
        let branch: GitHubBranch = serde_json::from_str(json).unwrap();
        assert_eq!(branch.name, "main");
        assert!(branch.protected);
    }

    #[test]
    fn deserialize_github_commit() {
        let json = r#"{"sha":"abc123","commit":{"message":"Initial commit","author":{"name":"Monalisa","date":"2023-01-01T00:00:00Z"}}}"#;
        let commit: GitHubCommit = serde_json::from_str(json).unwrap();
        assert_eq!(commit.sha, "abc123");
        assert_eq!(commit.commit.message, "Initial commit");
    }

    #[test]
    fn base_url_uses_env_override() {
        // Without env var, should return default.
        // SAFETY: single-threaded test; no other threads reading this var.
        unsafe { std::env::remove_var("GITHUB_API_URL") };
        assert_eq!(base_url(), DEFAULT_BASE_URL);
    }
}
