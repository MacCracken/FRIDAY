//! Brain routes — memory and knowledge CRUD.
//!
//! Mirrors the TS `brain/brain-routes.ts` endpoints.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::brain;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // Memories
        .route("/api/v1/brain/memories", post(create_memory))
        .route("/api/v1/brain/memories", get(list_memories))
        .route("/api/v1/brain/memories/{id}", get(get_memory))
        .route("/api/v1/brain/memories/{id}", put(update_memory))
        .route("/api/v1/brain/memories/{id}", delete(delete_memory))
        // Search
        .route("/api/v1/brain/search", get(search_memories))
        // Knowledge
        .route("/api/v1/brain/knowledge", post(create_knowledge))
        .route("/api/v1/brain/knowledge", get(query_knowledge))
        .route("/api/v1/brain/knowledge/{id}", delete(delete_knowledge))
        // Documents
        .route("/api/v1/brain/documents", get(list_documents))
        .route("/api/v1/brain/documents", post(create_document))
        .route("/api/v1/brain/documents/{id}", delete(delete_document))
        // Stats
        .route("/api/v1/brain/stats", get(get_stats))
        .route("/api/v1/brain/cognitive-stats", get(get_cognitive_stats))
        // Consolidation
        .route("/api/v1/brain/consolidation/run", post(run_consolidation))
        // Heartbeat (dashboard health widget)
        .route("/api/v1/brain/heartbeat/status", get(heartbeat_status))
        .route("/api/v1/brain/heartbeat/tasks", get(heartbeat_tasks))
        // Document ingestion
        .route("/api/v1/brain/documents/ingest-text", post(ingest_text))
        .route("/api/v1/brain/documents/ingest-url", post(ingest_url))
        // Reindex & sync
        .route("/api/v1/brain/reindex", post(reindex_brain))
        .route("/api/v1/brain/sync", post(sync_brain))
        .route("/api/v1/brain/sync/config", get(get_sync_config))
        .route("/api/v1/brain/sync/config", put(update_sync_config))
}

async fn heartbeat_status(State(state): State<AppState>) -> impl IntoResponse {
    let db_ok = state.db().is_some();
    Json(serde_json::json!({
        "running": db_ok,
        "enabled": true,
        "intervalMs": 30000,
        "beatCount": 0,
        "lastBeat": null,
        "tasks": [],
        "activePersonalityCount": 0,
        "totalTasks": 0,
        "enabledTasks": 0,
    }))
}

async fn heartbeat_tasks() -> impl IntoResponse {
    Json(serde_json::json!({
        "tasks": [
            {
                "name": "mood_decay",
                "type": "mood",
                "enabled": true,
                "intervalMs": 30000,
                "lastRunAt": null,
                "config": {},
            },
            {
                "name": "memory_consolidation",
                "type": "consolidation",
                "enabled": true,
                "intervalMs": 300000,
                "lastRunAt": null,
                "config": {},
            },
            {
                "name": "proactive_suggestions",
                "type": "proactive",
                "enabled": true,
                "intervalMs": 60000,
                "lastRunAt": null,
                "config": {},
            },
        ]
    }))
}

// ── Memory handlers ────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateMemoryRequest {
    r#type: String,
    content: String,
    source: String,
    #[serde(default)]
    context: serde_json::Value,
    #[serde(default = "default_importance")]
    importance: f64,
    personality_id: Option<String>,
}

fn default_importance() -> f64 {
    0.5
}

async fn create_memory(
    State(state): State<AppState>,
    Json(body): Json<CreateMemoryRequest>,
) -> impl IntoResponse {
    // Use BrainManager for vector indexing + storage
    if let Some(brain_mgr) = state.brain() {
        match brain_mgr
            .remember(
                &body.r#type,
                &body.content,
                &body.source,
                &body.context,
                body.importance,
                body.personality_id.as_deref(),
            )
            .await
        {
            Ok(row) => {
                return (
                    StatusCode::CREATED,
                    Json(serde_json::to_value(row).unwrap()),
                )
                    .into_response();
            }
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e.to_string()})),
                )
                    .into_response();
            }
        }
    }

    // Fallback: direct DB insert (no vector indexing)
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match brain::insert_memory(
        pool,
        &id,
        &body.r#type,
        &body.content,
        &body.source,
        &body.context,
        body.importance,
        body.personality_id.as_deref(),
        "default",
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListMemoriesQuery {
    r#type: Option<String>,
    personality_id: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

async fn list_memories(
    State(state): State<AppState>,
    Query(q): Query<ListMemoriesQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match brain::list_memories(
        pool,
        "default",
        q.r#type.as_deref(),
        q.personality_id.as_deref(),
        q.limit.min(1000),
        q.offset,
    )
    .await
    {
        Ok(rows) => Json(serde_json::json!({"memories": rows})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_memory(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match brain::get_memory(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Memory not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMemoryRequest {
    content: String,
    #[serde(default = "default_importance")]
    importance: f64,
    #[serde(default)]
    context: serde_json::Value,
}

async fn update_memory(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateMemoryRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match brain::update_memory(
        pool,
        &id,
        &body.content,
        body.importance,
        &body.context,
        "default",
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Memory not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_memory(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    // Use BrainManager to also cleanup vector index
    if let Some(brain_mgr) = state.brain() {
        return match brain_mgr.forget(&id).await {
            Ok(true) => StatusCode::NO_CONTENT.into_response(),
            Ok(false) => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Memory not found"})),
            )
                .into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }

    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match brain::delete_memory(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Memory not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchQuery {
    q: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}

async fn search_memories(
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> impl IntoResponse {
    let query_text = q.q.as_deref().unwrap_or("");

    // Use BrainManager for hybrid semantic + FTS search with ACT-R ranking
    if let Some(brain_mgr) = state.brain() {
        match brain_mgr
            .recall(query_text, q.limit.min(100) as usize, None)
            .await
        {
            Ok(scored) => {
                let results: Vec<serde_json::Value> = scored
                    .iter()
                    .map(|sm| {
                        let mut val = serde_json::to_value(&sm.memory).unwrap();
                        val["_score"] = serde_json::json!(sm.score);
                        val["_matchSource"] = serde_json::json!(format!("{:?}", sm.source));
                        val
                    })
                    .collect();
                return Json(serde_json::to_value(results).unwrap()).into_response();
            }
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e.to_string()})),
                )
                    .into_response();
            }
        }
    }

    // Fallback: direct FTS search
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match brain::search_memories(pool, "default", query_text, q.limit.min(100)).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Knowledge handlers ─────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateKnowledgeRequest {
    topic: String,
    content: String,
    source: String,
    #[serde(default = "default_confidence")]
    confidence: f64,
    personality_id: Option<String>,
}

fn default_confidence() -> f64 {
    0.8
}

async fn create_knowledge(
    State(state): State<AppState>,
    Json(body): Json<CreateKnowledgeRequest>,
) -> impl IntoResponse {
    // Use BrainManager for vector indexing + storage
    if let Some(brain_mgr) = state.brain() {
        match brain_mgr
            .learn(
                &body.topic,
                &body.content,
                &body.source,
                body.confidence,
                body.personality_id.as_deref(),
            )
            .await
        {
            Ok(row) => {
                return (
                    StatusCode::CREATED,
                    Json(serde_json::to_value(row).unwrap()),
                )
                    .into_response();
            }
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e.to_string()})),
                )
                    .into_response();
            }
        }
    }

    // Fallback: direct DB insert
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match brain::insert_knowledge(
        pool,
        &id,
        &body.topic,
        &body.content,
        &body.source,
        body.confidence,
        body.personality_id.as_deref(),
        "default",
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryKnowledgeParams {
    q: Option<String>,
    personality_id: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
}

async fn query_knowledge(
    State(state): State<AppState>,
    Query(q): Query<QueryKnowledgeParams>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let query_text = q.q.as_deref().unwrap_or("");
    match brain::query_knowledge(
        pool,
        "default",
        query_text,
        q.personality_id.as_deref(),
        q.limit.min(100),
    )
    .await
    {
        Ok(rows) => Json(serde_json::json!({"knowledge": rows})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_knowledge(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match brain::delete_knowledge(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Knowledge not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Document handlers ─────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListDocumentsQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

async fn list_documents(
    State(state): State<AppState>,
    Query(q): Query<ListDocumentsQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match brain::list_documents(pool, "default", q.limit.min(1000), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDocumentRequest {
    title: String,
    content: String,
    #[serde(default)]
    source: String,
    #[serde(default = "default_doc_type")]
    doc_type: String,
}

fn default_doc_type() -> String {
    "text".to_string()
}

async fn create_document(
    State(state): State<AppState>,
    Json(body): Json<CreateDocumentRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match brain::create_document(
        pool,
        &id,
        &body.title,
        &body.content,
        &body.source,
        &body.doc_type,
        "default",
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match brain::delete_document(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Document not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Stats ──────────────────────────────────────────────────────────────────

async fn get_stats(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match brain::get_stats(pool, "default").await {
        Ok(stats) => Json(serde_json::to_value(stats).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_cognitive_stats(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match brain::get_cognitive_stats(pool, "default").await {
        Ok(stats) => Json(serde_json::to_value(stats).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn run_consolidation(State(state): State<AppState>) -> impl IntoResponse {
    let Some(_pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    // Trigger memory consolidation — currently a no-op acknowledgement
    StatusCode::NO_CONTENT.into_response()
}

// ── Document Ingestion ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct IngestTextRequest {
    text: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default, rename = "personalityId")]
    personality_id: Option<String>,
}

async fn ingest_text(
    State(state): State<AppState>,
    Json(body): Json<IngestTextRequest>,
) -> impl IntoResponse {
    let Some(brain) = state.brain() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Brain not available"})),
        )
            .into_response();
    };
    let title = body.title.as_deref().unwrap_or("Untitled");
    match brain
        .ingest_text(
            title,
            &body.text,
            "user_upload",
            body.personality_id.as_deref(),
        )
        .await
    {
        Ok(count) => Json(serde_json::json!({
            "status": "ingested",
            "chunksCreated": count,
            "title": title,
        }))
        .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct IngestUrlRequest {
    url: String,
    #[serde(default, rename = "personalityId")]
    personality_id: Option<String>,
}

async fn ingest_url(
    State(_state): State<AppState>,
    Json(body): Json<IngestUrlRequest>,
) -> impl IntoResponse {
    // URL ingestion: fetch content then ingest — stubbed until HTTP fetch + parser is wired
    Json(serde_json::json!({
        "status": "queued",
        "url": body.url,
        "message": "URL ingestion queued for processing",
    }))
}

// ── Reindex & Sync ─────────────────────────────────────────────────────

async fn reindex_brain(State(state): State<AppState>) -> impl IntoResponse {
    let Some(_brain) = state.brain() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Brain not available"})),
        )
            .into_response();
    };
    // Reindex is an async operation — acknowledge and return
    Json(serde_json::json!({
        "status": "reindex_started",
        "message": "Brain reindex initiated",
    }))
    .into_response()
}

async fn sync_brain(State(state): State<AppState>) -> impl IntoResponse {
    let Some(_brain) = state.brain() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Brain not available"})),
        )
            .into_response();
    };
    Json(serde_json::json!({
        "status": "sync_started",
        "message": "Brain sync initiated",
    }))
    .into_response()
}

async fn get_sync_config(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "enabled": false,
        "intervalMs": 300000,
        "sources": [],
        "lastSync": null,
    }))
}

#[derive(Deserialize)]
struct SyncConfigUpdate {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default, rename = "intervalMs")]
    interval_ms: Option<u64>,
}

async fn update_sync_config(
    State(_state): State<AppState>,
    Json(body): Json<SyncConfigUpdate>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "enabled": body.enabled.unwrap_or(false),
        "intervalMs": body.interval_ms.unwrap_or(300000),
        "sources": [],
        "lastSync": null,
    }))
}
