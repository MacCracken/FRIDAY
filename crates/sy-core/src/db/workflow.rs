//! Workflow storage — definitions and runs via PostgreSQL.

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

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
