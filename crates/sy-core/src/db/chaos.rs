//! Chaos storage — experiments via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ChaosExperimentRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub target: String,
    pub fault_type: String,
    pub config: serde_json::Value,
    pub status: String,
    pub result: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_experiments(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<ChaosExperimentRow>, sqlx::Error> {
    sqlx::query_as::<_, ChaosExperimentRow>(
        "SELECT * FROM chaos.experiments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_experiment(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ChaosExperimentRow>, sqlx::Error> {
    sqlx::query_as::<_, ChaosExperimentRow>("SELECT * FROM chaos.experiments WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

#[allow(clippy::too_many_arguments)]
pub async fn create_experiment(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    description: Option<&str>,
    target: &str,
    fault_type: &str,
    config: &serde_json::Value,
) -> Result<ChaosExperimentRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ChaosExperimentRow>(
        "INSERT INTO chaos.experiments (id, tenant_id, name, description, target, fault_type, config, status, result, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', '{}', $8, $8) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(description)
    .bind(target)
    .bind(fault_type)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn run_experiment(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ChaosExperimentRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ChaosExperimentRow>(
        "UPDATE chaos.experiments SET status = 'running', updated_at = $2 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(now)
    .fetch_optional(pool)
    .await
}

pub async fn abort_experiment(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ChaosExperimentRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ChaosExperimentRow>(
        "UPDATE chaos.experiments SET status = 'aborted', updated_at = $2 WHERE id = $1 AND status = 'running' RETURNING *",
    )
    .bind(id)
    .bind(now)
    .fetch_optional(pool)
    .await
}

pub async fn schedule_experiment(
    pool: &PgPool,
    id: &str,
    cron: Option<&str>,
    run_at: Option<i64>,
) -> Result<Option<ChaosExperimentRow>, sqlx::Error> {
    let now = now_ms();
    let schedule = serde_json::json!({"cron": cron, "runAt": run_at});
    sqlx::query_as::<_, ChaosExperimentRow>(
        "UPDATE chaos.experiments SET status = 'scheduled', config = config || $3, updated_at = $2 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(now)
    .bind(schedule)
    .fetch_optional(pool)
    .await
}

pub async fn delete_experiment(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM chaos.experiments WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
