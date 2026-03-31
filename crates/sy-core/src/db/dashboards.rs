//! Dashboard storage — custom dashboards via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DashboardRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub layout: serde_json::Value,
    pub owner_id: Option<String>,
    pub is_default: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_dashboards(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<DashboardRow>, sqlx::Error> {
    sqlx::query_as::<_, DashboardRow>(
        "SELECT * FROM public.dashboards ORDER BY name ASC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_dashboard(pool: &PgPool, id: &str) -> Result<Option<DashboardRow>, sqlx::Error> {
    sqlx::query_as::<_, DashboardRow>("SELECT * FROM public.dashboards WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}
