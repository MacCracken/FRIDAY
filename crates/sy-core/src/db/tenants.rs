//! Tenant storage.
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TenantRow {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub created_at: i64,
}

pub async fn list_tenants(pool: &PgPool) -> Result<Vec<TenantRow>, sqlx::Error> {
    sqlx::query_as::<_, TenantRow>(
        "SELECT id, name, enabled, created_at FROM auth.tenants ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await
}
