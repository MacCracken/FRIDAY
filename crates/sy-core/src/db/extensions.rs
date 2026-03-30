//! Extension storage.
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifestRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
}

pub async fn list_extensions(pool: &PgPool) -> Result<Vec<ExtensionManifestRow>, sqlx::Error> {
    sqlx::query_as::<_, ExtensionManifestRow>("SELECT id, name, description, version, enabled, created_at FROM extensions.manifests ORDER BY name ASC")
        .fetch_all(pool).await
}
