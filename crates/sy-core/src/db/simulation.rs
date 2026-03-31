//! Simulation storage — scenarios and runs via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SimulationScenarioRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub config: serde_json::Value,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SimulationRunRow {
    pub id: String,
    pub scenario_id: String,
    pub tenant_id: String,
    pub status: String,
    pub result: serde_json::Value,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub created_at: i64,
}

pub async fn list_scenarios(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<SimulationScenarioRow>, sqlx::Error> {
    sqlx::query_as::<_, SimulationScenarioRow>(
        "SELECT * FROM simulation.scenarios WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_scenario(
    pool: &PgPool,
    id: &str,
) -> Result<Option<SimulationScenarioRow>, sqlx::Error> {
    sqlx::query_as::<_, SimulationScenarioRow>("SELECT * FROM simulation.scenarios WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_scenario(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    description: Option<&str>,
    config: &serde_json::Value,
) -> Result<SimulationScenarioRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, SimulationScenarioRow>(
        "INSERT INTO simulation.scenarios (id, tenant_id, name, description, config, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $6) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(description)
    .bind(config)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn delete_scenario(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM simulation.scenarios WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn create_run(
    pool: &PgPool,
    id: &str,
    scenario_id: &str,
    tenant_id: &str,
) -> Result<SimulationRunRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, SimulationRunRow>(
        "INSERT INTO simulation.runs (id, scenario_id, tenant_id, status, result, started_at, created_at)
         VALUES ($1, $2, $3, 'running', '{}', $4, $4) RETURNING *",
    )
    .bind(id)
    .bind(scenario_id)
    .bind(tenant_id)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn list_runs(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<SimulationRunRow>, sqlx::Error> {
    sqlx::query_as::<_, SimulationRunRow>(
        "SELECT * FROM simulation.runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_run(pool: &PgPool, id: &str) -> Result<Option<SimulationRunRow>, sqlx::Error> {
    sqlx::query_as::<_, SimulationRunRow>("SELECT * FROM simulation.runs WHERE id = $1")
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
