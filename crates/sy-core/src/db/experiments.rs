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
    sqlx::query_as::<_, ExperimentRow>("SELECT id, name, status, variant_a, variant_b, created_at FROM experiment.experiments ORDER BY created_at DESC LIMIT $1")
        .bind(limit).fetch_all(pool).await
}
