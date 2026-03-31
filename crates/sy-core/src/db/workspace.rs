//! Workspace storage — workspaces via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub settings: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
    pub identity_provider_id: Option<String>,
    pub sso_domain: Option<String>,
    pub tenant_id: String,
}

pub async fn list_workspaces(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Vec<WorkspaceRow>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceRow>(
        "SELECT * FROM workspace.workspaces WHERE tenant_id = $1 ORDER BY name ASC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMemberRow {
    pub workspace_id: String,
    pub user_id: String,
    pub role: String,
    pub joined_at: i64,
}

pub async fn list_members(
    pool: &PgPool,
    workspace_id: &str,
) -> Result<Vec<WorkspaceMemberRow>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceMemberRow>(
        "SELECT workspace_id, user_id, role, joined_at FROM workspace.members WHERE workspace_id = $1 ORDER BY joined_at ASC",
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await
}

pub async fn remove_member(
    pool: &PgPool,
    workspace_id: &str,
    user_id: &str,
) -> Result<bool, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM workspace.members WHERE workspace_id = $1 AND user_id = $2")
            .bind(workspace_id)
            .bind(user_id)
            .execute(pool)
            .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn get_workspace(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<Option<WorkspaceRow>, sqlx::Error> {
    sqlx::query_as::<_, WorkspaceRow>(
        "SELECT * FROM workspace.workspaces WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}
