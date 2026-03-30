//! Task storage — execution tasks via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TaskRow {
    pub id: String,
    pub correlation_id: Option<String>,
    pub parent_task_id: Option<String>,
    pub r#type: String,
    pub name: String,
    pub description: Option<String>,
    pub input_hash: String,
    pub status: String,
    pub result_json: Option<serde_json::Value>,
    pub resources_json: Option<serde_json::Value>,
    pub security_context_json: serde_json::Value,
    pub timeout_ms: i32,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub duration_ms: Option<i64>,
    pub tenant_id: String,
}

pub async fn list_tasks(
    pool: &PgPool,
    tenant_id: &str,
    status: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<TaskRow>, sqlx::Error> {
    if let Some(s) = status {
        sqlx::query_as::<_, TaskRow>(
            "SELECT * FROM task.tasks WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4",
        )
        .bind(tenant_id).bind(s).bind(limit).bind(offset)
        .fetch_all(pool).await
    } else {
        sqlx::query_as::<_, TaskRow>(
            "SELECT * FROM task.tasks WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(tenant_id).bind(limit).bind(offset)
        .fetch_all(pool).await
    }
}

pub async fn get_task(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<Option<TaskRow>, sqlx::Error> {
    sqlx::query_as::<_, TaskRow>("SELECT * FROM task.tasks WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(pool)
        .await
}
