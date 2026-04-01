//! Multimodal storage — custom vocabulary via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyRow {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub phrases: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

pub async fn list_vocabularies(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<VocabularyRow>, sqlx::Error> {
    sqlx::query_as::<_, VocabularyRow>(
        "SELECT * FROM multimodal.vocabularies WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn create_vocabulary(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
    name: &str,
    phrases: &serde_json::Value,
) -> Result<VocabularyRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, VocabularyRow>(
        "INSERT INTO multimodal.vocabularies (id, tenant_id, name, phrases, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING *",
    )
    .bind(id)
    .bind(tenant_id)
    .bind(name)
    .bind(phrases)
    .bind(now)
    .fetch_one(pool)
    .await
}

pub async fn delete_vocabulary_by_name(
    pool: &PgPool,
    tenant_id: &str,
    name: &str,
) -> Result<bool, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM multimodal.vocabularies WHERE tenant_id = $1 AND name = $2")
            .bind(tenant_id)
            .bind(name)
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
