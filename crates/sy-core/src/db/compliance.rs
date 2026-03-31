//! Compliance storage — SOA entries via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SoaRow {
    pub id: String,
    pub control_id: String,
    pub title: String,
    pub description: Option<String>,
    pub applicable: bool,
    pub implemented: bool,
    pub justification: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_soa(pool: &PgPool, limit: i64, offset: i64) -> Result<Vec<SoaRow>, sqlx::Error> {
    sqlx::query_as::<_, SoaRow>(
        "SELECT * FROM compliance.soa ORDER BY control_id ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_soa(pool: &PgPool, id: &str) -> Result<Option<SoaRow>, sqlx::Error> {
    sqlx::query_as::<_, SoaRow>("SELECT * FROM compliance.soa WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}
