//! Eval storage — scenarios, suites, runs via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EvalScenarioRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub description: Option<String>,
    pub steps: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EvalSuiteRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub scenario_ids: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EvalRunRow {
    pub id: String,
    pub tenant_id: String,
    pub kind: String,
    pub ref_id: String,
    pub status: String,
    pub results: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

// ── Scenarios ────────────────────────────────────────────────

pub async fn list_scenarios(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<EvalScenarioRow>, sqlx::Error> {
    sqlx::query_as::<_, EvalScenarioRow>(
        "SELECT * FROM eval.scenarios WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_scenario(pool: &PgPool, id: &str) -> Result<Option<EvalScenarioRow>, sqlx::Error> {
    sqlx::query_as::<_, EvalScenarioRow>("SELECT * FROM eval.scenarios WHERE id = $1")
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
    steps: &serde_json::Value,
) -> Result<EvalScenarioRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, EvalScenarioRow>(
        "INSERT INTO eval.scenarios (id, tenant_id, name, description, steps, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(description)
    .bind(steps)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn update_scenario(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    steps: &serde_json::Value,
) -> Result<Option<EvalScenarioRow>, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, EvalScenarioRow>(
        "UPDATE eval.scenarios SET name = $2, description = $3, steps = $4, updated_at = $5 WHERE id = $1 RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(steps)
    .bind(now)
    .fetch_optional(pool)
    .await
}

pub async fn delete_scenario(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM eval.scenarios WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Suites ───────────────────────────────────────────────────

pub async fn list_suites(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<EvalSuiteRow>, sqlx::Error> {
    sqlx::query_as::<_, EvalSuiteRow>(
        "SELECT * FROM eval.suites WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_suite(pool: &PgPool, id: &str) -> Result<Option<EvalSuiteRow>, sqlx::Error> {
    sqlx::query_as::<_, EvalSuiteRow>("SELECT * FROM eval.suites WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_suite(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    scenario_ids: &serde_json::Value,
) -> Result<EvalSuiteRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, EvalSuiteRow>(
        "INSERT INTO eval.suites (id, tenant_id, name, scenario_ids, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(scenario_ids)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn delete_suite(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM eval.suites WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Runs ─────────────────────────────────────────────────────

pub async fn list_runs(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<EvalRunRow>, sqlx::Error> {
    sqlx::query_as::<_, EvalRunRow>(
        "SELECT * FROM eval.runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_run(pool: &PgPool, id: &str) -> Result<Option<EvalRunRow>, sqlx::Error> {
    sqlx::query_as::<_, EvalRunRow>("SELECT * FROM eval.runs WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn create_run(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    kind: &str,
    ref_id: &str,
) -> Result<EvalRunRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, EvalRunRow>(
        "INSERT INTO eval.runs (id, tenant_id, kind, ref_id, status, results, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'running', '{}', $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(kind)
    .bind(ref_id)
    .bind(now)
    .fetch_one(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
