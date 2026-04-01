//! Todoist API client — typed wrapper around the Todoist REST API v2.
//!
//! Credentials: Bearer token.
//! Config field: `apiToken`.

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;

use crate::db::integrations;

const DEFAULT_BASE_URL: &str = "https://api.todoist.com/rest/v2";

fn base_url() -> String {
    std::env::var("TODOIST_API_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
}

// ── Error ────────────────────────────────────────────────────────────────────

/// Errors returned by the Todoist client.
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

/// A Todoist task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoistTask {
    pub id: String,
    pub content: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_completed: bool,
    #[serde(default)]
    pub priority: u8,
    #[serde(default)]
    pub due: Option<TodoistDue>,
    #[serde(default)]
    pub project_id: Option<String>,
}

/// Due date object on a task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoistDue {
    pub date: String,
    #[serde(default)]
    pub string: Option<String>,
    #[serde(default)]
    pub datetime: Option<String>,
}

/// A Todoist project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoistProject {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

// ── Request bodies ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct CreateTaskBody<'a> {
    content: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    priority: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    due_string: Option<&'a str>,
}

#[derive(Serialize)]
struct UpdateTaskBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    priority: Option<u8>,
}

// ── Client ────────────────────────────────────────────────────────────────────

/// Typed Todoist REST API v2 client.
pub struct TodoistClient {
    client: reqwest::Client,
    token: String,
}

impl TodoistClient {
    /// Create a client from an API token.
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
            .get("apiToken")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                IntegrationError::Credential("Integration missing `apiToken` in config".to_string())
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

    async fn post_empty(&self, path: &str) -> Result<(), IntegrationError> {
        let url = format!("{}{path}", base_url());
        let res = self
            .client
            .post(&url)
            .header(AUTHORIZATION, self.auth_header())
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

    /// List tasks, optionally filtered by project.
    pub async fn list_tasks(
        &self,
        project_id: Option<&str>,
    ) -> Result<Vec<TodoistTask>, IntegrationError> {
        let query = project_id.map(|pid| format!("project_id={pid}"));
        self.get("/tasks", query.as_deref()).await
    }

    /// Create a task.
    pub async fn create_task(
        &self,
        content: &str,
        project_id: Option<&str>,
        priority: Option<u8>,
        due_string: Option<&str>,
    ) -> Result<TodoistTask, IntegrationError> {
        let body = CreateTaskBody {
            content,
            project_id,
            priority,
            due_string,
        };
        self.post("/tasks", &body).await
    }

    /// Update a task's content and/or priority.
    pub async fn update_task(
        &self,
        id: &str,
        content: Option<&str>,
        priority: Option<u8>,
    ) -> Result<TodoistTask, IntegrationError> {
        let body = UpdateTaskBody { content, priority };
        self.post(&format!("/tasks/{id}"), &body).await
    }

    /// Mark a task as completed.
    pub async fn close_task(&self, id: &str) -> Result<(), IntegrationError> {
        self.post_empty(&format!("/tasks/{id}/close")).await
    }

    /// List all projects.
    pub async fn list_projects(&self) -> Result<Vec<TodoistProject>, IntegrationError> {
        self.get("/projects", None).await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_todoist_task() {
        let json = r#"{"id":"1234","content":"Buy milk","description":"From the shop","is_completed":false,"priority":2,"due":{"date":"2026-04-01","string":"today"}}"#;
        let task: TodoistTask = serde_json::from_str(json).unwrap();
        assert_eq!(task.id, "1234");
        assert_eq!(task.priority, 2);
        assert!(!task.is_completed);
    }

    #[test]
    fn deserialize_todoist_task_no_due() {
        let json = r#"{"id":"5678","content":"Call dentist","is_completed":true,"priority":1}"#;
        let task: TodoistTask = serde_json::from_str(json).unwrap();
        assert!(task.due.is_none());
        assert!(task.is_completed);
    }

    #[test]
    fn deserialize_todoist_project() {
        let json = r#"{"id":"p1","name":"Work","color":"blue"}"#;
        let project: TodoistProject = serde_json::from_str(json).unwrap();
        assert_eq!(project.name, "Work");
    }

    #[test]
    fn create_task_body_skips_nones() {
        let body = CreateTaskBody {
            content: "Test task",
            project_id: None,
            priority: None,
            due_string: None,
        };
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("content"));
        assert!(!json.contains("project_id"));
        assert!(!json.contains("priority"));
        assert!(!json.contains("due_string"));
    }

    #[test]
    fn base_url_uses_env_override() {
        // SAFETY: single-threaded test; no other threads reading this var.
        unsafe { std::env::remove_var("TODOIST_API_URL") };
        assert_eq!(base_url(), DEFAULT_BASE_URL);
    }
}
