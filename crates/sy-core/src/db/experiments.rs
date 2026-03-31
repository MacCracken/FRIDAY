//! Experiment storage — A/B tests.
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentRow {
    pub id: String,
    pub name: String,
    pub status: String,
    pub variant_a: Option<String>,
    pub variant_b: Option<String>,
    pub created_at: i64,
}

pub async fn list_experiments(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<ExperimentRow>, sqlx::Error> {
    sqlx::query_as::<_, ExperimentRow>(
        "SELECT id, name, status, variant_a, variant_b, created_at FROM experiment.experiments ORDER BY created_at DESC LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// Get experiment by ID.
pub async fn get_experiment(pool: &PgPool, id: &str) -> Result<Option<ExperimentRow>, sqlx::Error> {
    sqlx::query_as::<_, ExperimentRow>(
        "SELECT id, name, status, variant_a, variant_b, created_at FROM experiment.experiments WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Create a new experiment.
pub async fn create_experiment(
    pool: &PgPool,
    id: &str,
    name: &str,
    variant_a: Option<&str>,
    variant_b: Option<&str>,
) -> Result<ExperimentRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ExperimentRow>(
        "INSERT INTO experiment.experiments (id, name, status, variant_a, variant_b, created_at)
         VALUES ($1, $2, 'draft', $3, $4, $5)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(variant_a)
    .bind(variant_b)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Delete an experiment by ID.
pub async fn delete_experiment(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM experiment.experiments WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Update experiment status.
pub async fn update_experiment_status(
    pool: &PgPool,
    id: &str,
    status: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE experiment.experiments SET status = $1 WHERE id = $2")
        .bind(status)
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
