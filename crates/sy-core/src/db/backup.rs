//! Backup storage.
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BackupRow {
    pub id: String,
    pub status: String,
    pub size_bytes: Option<i64>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

pub async fn list_backups(pool: &PgPool, limit: i64) -> Result<Vec<BackupRow>, sqlx::Error> {
    sqlx::query_as::<_, BackupRow>("SELECT id, status, size_bytes, created_at, completed_at FROM admin.backups ORDER BY created_at DESC LIMIT $1")
        .bind(limit).fetch_all(pool).await
}
