//! Analytics storage — conversation summaries and sentiment.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummaryRow {
    pub id: String,
    pub conversation_id: String,
    pub summary: String,
    pub topics: serde_json::Value,
    pub sentiment_score: Option<f64>,
    pub created_at: i64,
}

pub async fn list_summaries(
    pool: &PgPool,
    limit: i64,
    offset: i64,
) -> Result<Vec<ConversationSummaryRow>, sqlx::Error> {
    sqlx::query_as::<_, ConversationSummaryRow>("SELECT * FROM analytics.conversation_summaries ORDER BY created_at DESC LIMIT $1 OFFSET $2")
        .bind(limit).bind(offset).fetch_all(pool).await
}

pub async fn list_sentiments(
    pool: &PgPool,
    conversation_id: &str,
) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as("SELECT row_to_json(t) FROM analytics.turn_sentiments t WHERE conversation_id = $1 ORDER BY created_at ASC")
        .bind(conversation_id).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}
