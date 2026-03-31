//! Editor storage — annotations via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EditorAnnotationRow {
    pub id: String,
    pub file_path: Option<String>,
    pub line_start: Option<i32>,
    pub line_end: Option<i32>,
    pub content: String,
    pub annotation_type: String,
    pub created_at: i64,
}

pub async fn list_annotations(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<EditorAnnotationRow>, sqlx::Error> {
    sqlx::query_as::<_, EditorAnnotationRow>(
        "SELECT * FROM editor.annotations ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

pub async fn get_annotation(
    pool: &PgPool,
    id: &str,
) -> Result<Option<EditorAnnotationRow>, sqlx::Error> {
    sqlx::query_as::<_, EditorAnnotationRow>("SELECT * FROM editor.annotations WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
}
