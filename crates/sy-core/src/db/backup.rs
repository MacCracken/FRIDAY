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
    sqlx::query_as::<_, BackupRow>(
        "SELECT id, status, size_bytes, created_at, completed_at FROM admin.backups ORDER BY created_at DESC LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// Get a backup by ID.
pub async fn get_backup(pool: &PgPool, id: &str) -> Result<Option<BackupRow>, sqlx::Error> {
    sqlx::query_as::<_, BackupRow>(
        "SELECT id, status, size_bytes, created_at, completed_at FROM admin.backups WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Create a new backup record.
pub async fn create_backup(pool: &PgPool, id: &str) -> Result<BackupRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, BackupRow>(
        "INSERT INTO admin.backups (id, status, created_at)
         VALUES ($1, 'pending', $2)
         RETURNING *",
    )
    .bind(id)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Delete a backup by ID.
pub async fn delete_backup(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM admin.backups WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Update backup status (e.g. to 'restoring').
pub async fn update_backup_status(
    pool: &PgPool,
    id: &str,
    status: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE admin.backups SET status = $1 WHERE id = $2")
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
