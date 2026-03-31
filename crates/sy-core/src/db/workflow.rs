//! Workflow storage — definitions, runs, and versions via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRow {
    pub id: uuid::Uuid,
    pub name: String,
    pub description: Option<String>,
    pub steps_json: serde_json::Value,
    pub edges_json: serde_json::Value,
    pub triggers_json: serde_json::Value,
    pub is_enabled: bool,
    pub version: i32,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub autonomy_level: String,
    pub emergency_stop_procedure: Option<String>,
    pub source: String,
    pub requires_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunRow {
    pub id: uuid::Uuid,
    pub workflow_id: uuid::Uuid,
    pub workflow_name: String,
    pub status: String,
    pub input_json: Option<serde_json::Value>,
    pub output_json: Option<serde_json::Value>,
    pub error: Option<String>,
    pub triggered_by: String,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowVersionRow {
    pub id: uuid::Uuid,
    pub workflow_id: uuid::Uuid,
    pub version: i32,
    pub steps_json: serde_json::Value,
    pub edges_json: serde_json::Value,
    pub created_by: String,
    pub created_at: i64,
}

pub async fn list_workflows(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<WorkflowRow>, sqlx::Error> {
    sqlx::query_as::<_, WorkflowRow>(
        "SELECT * FROM workflow.definitions ORDER BY updated_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_workflow(
    pool: &PgPool,
    id: uuid::Uuid,
) -> Result<Option<WorkflowRow>, sqlx::Error> {
    sqlx::query_as::<_, WorkflowRow>("SELECT * FROM workflow.definitions WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_workflow(
    pool: &PgPool,
    name: &str,
    description: Option<&str>,
    steps_json: &serde_json::Value,
    edges_json: &serde_json::Value,
) -> Result<WorkflowRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, WorkflowRow>(
        "INSERT INTO workflow.definitions (name, description, steps_json, edges_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING *",
    )
    .bind(name)
    .bind(description)
    .bind(steps_json)
    .bind(edges_json)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn delete_workflow(pool: &PgPool, id: uuid::Uuid) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM workflow.definitions WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn import_workflow(
    pool: &PgPool,
    name: &str,
    description: Option<&str>,
    steps_json: &serde_json::Value,
    edges_json: &serde_json::Value,
    source: &str,
) -> Result<WorkflowRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, WorkflowRow>(
        "INSERT INTO workflow.definitions (name, description, steps_json, edges_json, source, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING *",
    )
    .bind(name)
    .bind(description)
    .bind(steps_json)
    .bind(edges_json)
    .bind(source)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_runs(
    pool: &PgPool,
    workflow_id: Option<uuid::Uuid>,
    limit: i64,
    offset: i64,
) -> Result<Vec<WorkflowRunRow>, sqlx::Error> {
    if let Some(wid) = workflow_id {
        sqlx::query_as::<_, WorkflowRunRow>(
            "SELECT * FROM workflow.runs WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(wid)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, WorkflowRunRow>(
            "SELECT * FROM workflow.runs ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
    }
}

pub async fn list_runs_for_workflow(
    pool: &PgPool,
    workflow_id: uuid::Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<WorkflowRunRow>, sqlx::Error> {
    sqlx::query_as::<_, WorkflowRunRow>(
        "SELECT * FROM workflow.runs WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(workflow_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn create_run(
    pool: &PgPool,
    workflow_id: uuid::Uuid,
    workflow_name: &str,
    input_json: Option<&serde_json::Value>,
    triggered_by: &str,
) -> Result<WorkflowRunRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, WorkflowRunRow>(
        "INSERT INTO workflow.runs (workflow_id, workflow_name, input_json, triggered_by, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    )
    .bind(workflow_id).bind(workflow_name).bind(input_json).bind(triggered_by).bind(now)
    .fetch_one(pool).await
}

pub async fn get_run(pool: &PgPool, id: uuid::Uuid) -> Result<Option<WorkflowRunRow>, sqlx::Error> {
    sqlx::query_as::<_, WorkflowRunRow>("SELECT * FROM workflow.runs WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn list_versions(
    pool: &PgPool,
    workflow_id: uuid::Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<WorkflowVersionRow>, sqlx::Error> {
    sqlx::query_as::<_, WorkflowVersionRow>(
        "SELECT * FROM workflow.versions WHERE workflow_id = $1 ORDER BY version DESC LIMIT $2 OFFSET $3",
    )
    .bind(workflow_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_version(
    pool: &PgPool,
    workflow_id: uuid::Uuid,
    id_or_tag: &str,
) -> Result<Option<WorkflowVersionRow>, sqlx::Error> {
    // Try by UUID first, then fall back to tag/version number lookup
    if let Ok(vid) = id_or_tag.parse::<uuid::Uuid>() {
        sqlx::query_as::<_, WorkflowVersionRow>(
            "SELECT * FROM workflow.versions WHERE id = $1 AND workflow_id = $2",
        )
        .bind(vid)
        .bind(workflow_id)
        .fetch_optional(pool)
        .await
    } else if let Ok(v) = id_or_tag.parse::<i32>() {
        sqlx::query_as::<_, WorkflowVersionRow>(
            "SELECT * FROM workflow.versions WHERE workflow_id = $1 AND version = $2",
        )
        .bind(workflow_id)
        .bind(v)
        .fetch_optional(pool)
        .await
    } else {
        // Tag-based lookup — search by tag column if it exists
        sqlx::query_as::<_, WorkflowVersionRow>(
            "SELECT * FROM workflow.versions WHERE workflow_id = $1 AND created_by = $2 LIMIT 1",
        )
        .bind(workflow_id)
        .bind(id_or_tag)
        .fetch_optional(pool)
        .await
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
