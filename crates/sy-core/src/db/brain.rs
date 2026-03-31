//! Brain storage — memories and knowledge CRUD via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

/// Memory row from brain.memories table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRow {
    pub id: String,
    pub r#type: String,
    pub content: String,
    pub source: String,
    pub context: serde_json::Value,
    pub importance: f64,
    pub access_count: i32,
    pub last_accessed_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub personality_id: Option<String>,
    pub tenant_id: String,
}

/// Knowledge row from brain.knowledge table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeRow {
    pub id: String,
    pub topic: String,
    pub content: String,
    pub source: String,
    pub confidence: f64,
    pub supersedes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub personality_id: Option<String>,
    pub tenant_id: String,
}

/// Document row from brain.documents table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRow {
    pub id: String,
    pub title: String,
    pub content: String,
    pub source: String,
    pub doc_type: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub tenant_id: String,
}

/// Cognitive stats across brain subsystems.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CognitiveStats {
    pub memory_count: i64,
    pub knowledge_count: i64,
    pub avg_relevance: f64,
}

/// Insert a new memory.
#[allow(clippy::too_many_arguments)]
pub async fn insert_memory(
    pool: &PgPool,
    id: &str,
    memory_type: &str,
    content: &str,
    source: &str,
    context: &serde_json::Value,
    importance: f64,
    personality_id: Option<&str>,
    tenant_id: &str,
) -> Result<MemoryRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, MemoryRow>(
        "INSERT INTO brain.memories (id, type, content, source, context, importance, access_count, created_at, updated_at, personality_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $7, $8, $9)
         RETURNING *",
    )
    .bind(id)
    .bind(memory_type)
    .bind(content)
    .bind(source)
    .bind(context)
    .bind(importance)
    .bind(now)
    .bind(personality_id)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Get a memory by ID.
pub async fn get_memory(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<Option<MemoryRow>, sqlx::Error> {
    sqlx::query_as::<_, MemoryRow>("SELECT * FROM brain.memories WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(pool)
        .await
}

/// List memories with optional type and personality filter.
pub async fn list_memories(
    pool: &PgPool,
    tenant_id: &str,
    memory_type: Option<&str>,
    personality_id: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<MemoryRow>, sqlx::Error> {
    let mut query = String::from("SELECT * FROM brain.memories WHERE tenant_id = $1");
    let mut param_idx = 2;

    if memory_type.is_some() {
        query.push_str(&format!(" AND type = ${param_idx}"));
        param_idx += 1;
    }
    if personality_id.is_some() {
        query.push_str(&format!(
            " AND (personality_id = ${param_idx} OR personality_id IS NULL)"
        ));
        param_idx += 1;
    }
    let _ = param_idx; // suppress unused warning

    query.push_str(" ORDER BY created_at DESC LIMIT $");
    let limit_idx = if memory_type.is_some() && personality_id.is_some() {
        4
    } else if memory_type.is_some() || personality_id.is_some() {
        3
    } else {
        2
    };
    query.push_str(&format!("{limit_idx} OFFSET ${}", limit_idx + 1));

    // Build the query dynamically. For simplicity, use the simpler pattern
    // when no filters are applied.
    if memory_type.is_none() && personality_id.is_none() {
        return sqlx::query_as::<_, MemoryRow>(
            "SELECT * FROM brain.memories WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        )
        .bind(tenant_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await;
    }

    if let Some(mt) = memory_type {
        if let Some(pid) = personality_id {
            return sqlx::query_as::<_, MemoryRow>(
                "SELECT * FROM brain.memories WHERE tenant_id = $1 AND type = $2 AND (personality_id = $3 OR personality_id IS NULL) ORDER BY created_at DESC LIMIT $4 OFFSET $5",
            )
            .bind(tenant_id)
            .bind(mt)
            .bind(pid)
            .bind(limit)
            .bind(offset)
            .fetch_all(pool)
            .await;
        }
        return sqlx::query_as::<_, MemoryRow>(
            "SELECT * FROM brain.memories WHERE tenant_id = $1 AND type = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4",
        )
        .bind(tenant_id)
        .bind(mt)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await;
    }

    if let Some(pid) = personality_id {
        return sqlx::query_as::<_, MemoryRow>(
            "SELECT * FROM brain.memories WHERE tenant_id = $1 AND (personality_id = $2 OR personality_id IS NULL) ORDER BY created_at DESC LIMIT $3 OFFSET $4",
        )
        .bind(tenant_id)
        .bind(pid)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await;
    }

    unreachable!()
}

/// Update a memory by ID.
pub async fn update_memory(
    pool: &PgPool,
    id: &str,
    content: &str,
    importance: f64,
    context: &serde_json::Value,
    tenant_id: &str,
) -> Result<Option<MemoryRow>, sqlx::Error> {
    sqlx::query_as::<_, MemoryRow>(
        "UPDATE brain.memories SET content = $1, importance = $2, context = $3, updated_at = $4
         WHERE id = $5 AND tenant_id = $6
         RETURNING *",
    )
    .bind(content)
    .bind(importance)
    .bind(context)
    .bind(now_ms())
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Search memories by content substring.
pub async fn search_memories(
    pool: &PgPool,
    tenant_id: &str,
    query: &str,
    limit: i64,
) -> Result<Vec<MemoryRow>, sqlx::Error> {
    let pattern = format!("%{query}%");
    sqlx::query_as::<_, MemoryRow>(
        "SELECT * FROM brain.memories WHERE tenant_id = $1 AND content ILIKE $2 ORDER BY importance DESC, created_at DESC LIMIT $3",
    )
    .bind(tenant_id)
    .bind(&pattern)
    .bind(limit)
    .fetch_all(pool)
    .await
}

/// Delete a memory by ID.
pub async fn delete_memory(pool: &PgPool, id: &str, tenant_id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM brain.memories WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Insert a knowledge entry.
#[allow(clippy::too_many_arguments)]
pub async fn insert_knowledge(
    pool: &PgPool,
    id: &str,
    topic: &str,
    content: &str,
    source: &str,
    confidence: f64,
    personality_id: Option<&str>,
    tenant_id: &str,
) -> Result<KnowledgeRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, KnowledgeRow>(
        "INSERT INTO brain.knowledge (id, topic, content, source, confidence, created_at, updated_at, personality_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8)
         RETURNING *",
    )
    .bind(id)
    .bind(topic)
    .bind(content)
    .bind(source)
    .bind(confidence)
    .bind(now)
    .bind(personality_id)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Query knowledge entries by topic substring.
pub async fn query_knowledge(
    pool: &PgPool,
    tenant_id: &str,
    query: &str,
    personality_id: Option<&str>,
    limit: i64,
) -> Result<Vec<KnowledgeRow>, sqlx::Error> {
    let pattern = format!("%{query}%");
    if let Some(pid) = personality_id {
        sqlx::query_as::<_, KnowledgeRow>(
            "SELECT * FROM brain.knowledge WHERE tenant_id = $1 AND (topic ILIKE $2 OR content ILIKE $2) AND (personality_id = $3 OR personality_id IS NULL) ORDER BY confidence DESC LIMIT $4",
        )
        .bind(tenant_id)
        .bind(&pattern)
        .bind(pid)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, KnowledgeRow>(
            "SELECT * FROM brain.knowledge WHERE tenant_id = $1 AND (topic ILIKE $2 OR content ILIKE $2) ORDER BY confidence DESC LIMIT $3",
        )
        .bind(tenant_id)
        .bind(&pattern)
        .bind(limit)
        .fetch_all(pool)
        .await
    }
}

/// Delete a knowledge entry by ID.
pub async fn delete_knowledge(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM brain.knowledge WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// List documents.
pub async fn list_documents(
    pool: &PgPool,
    tenant_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<DocumentRow>, sqlx::Error> {
    sqlx::query_as::<_, DocumentRow>(
        "SELECT * FROM brain.documents WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
    )
    .bind(tenant_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
}

/// Create a document.
pub async fn create_document(
    pool: &PgPool,
    id: &str,
    title: &str,
    content: &str,
    source: &str,
    doc_type: &str,
    tenant_id: &str,
) -> Result<DocumentRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, DocumentRow>(
        "INSERT INTO brain.documents (id, title, content, source, doc_type, created_at, updated_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
         RETURNING *",
    )
    .bind(id)
    .bind(title)
    .bind(content)
    .bind(source)
    .bind(doc_type)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Delete a document by ID.
pub async fn delete_document(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM brain.documents WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Get cognitive stats (memory count, knowledge count, average relevance).
pub async fn get_cognitive_stats(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<CognitiveStats, sqlx::Error> {
    let memory_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM brain.memories WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(pool)
            .await?;
    let knowledge_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM brain.knowledge WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(pool)
            .await?;
    let avg_relevance: (Option<f64>,) =
        sqlx::query_as("SELECT AVG(importance) FROM brain.memories WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(pool)
            .await?;

    Ok(CognitiveStats {
        memory_count: memory_count.0,
        knowledge_count: knowledge_count.0,
        avg_relevance: avg_relevance.0.unwrap_or(0.0),
    })
}

/// Get brain stats (memory and knowledge counts).
pub async fn get_stats(pool: &PgPool, tenant_id: &str) -> Result<BrainStats, sqlx::Error> {
    let memory_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM brain.memories WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(pool)
            .await?;
    let knowledge_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM brain.knowledge WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(pool)
            .await?;

    Ok(BrainStats {
        memories_total: memory_count.0,
        knowledge_total: knowledge_count.0,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainStats {
    pub memories_total: i64,
    pub knowledge_total: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
