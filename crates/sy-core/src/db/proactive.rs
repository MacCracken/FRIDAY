//! Proactive automation storage.
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatLogRow {
    pub id: String,
    pub personality_id: Option<String>,
    pub trigger_type: String,
    pub created_at: i64,
}

pub async fn list_heartbeat_logs(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<HeartbeatLogRow>, sqlx::Error> {
    sqlx::query_as::<_, HeartbeatLogRow>("SELECT id, personality_id, trigger_type, created_at FROM proactive.heartbeat_log ORDER BY created_at DESC LIMIT $1")
        .bind(limit).fetch_all(pool).await
}
