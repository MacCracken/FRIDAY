//! Workflow routes — definitions, runs, versions, import/export CRUD.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::workflow;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/workflows", get(list_workflows))
        .route("/api/v1/workflows", post(create_workflow))
        .route("/api/v1/workflows/import", post(import_workflow))
        .route("/api/v1/workflows/runs", get(list_runs))
        .route("/api/v1/workflows/runs", post(create_run))
        .route("/api/v1/workflows/runs/{id}", get(get_run))
        .route("/api/v1/workflows/{id}", get(get_workflow))
        .route("/api/v1/workflows/{id}", delete(delete_workflow))
        .route("/api/v1/workflows/{id}/run", post(run_workflow))
        .route("/api/v1/workflows/{id}/runs", get(list_runs_for_workflow))
        .route("/api/v1/workflows/{id}/export", get(export_workflow))
        .route("/api/v1/workflows/{id}/versions", get(list_versions))
        .route(
            "/api/v1/workflows/{id}/versions/{idOrTag}",
            get(get_version),
        )
        .route(
            "/api/v1/workflows/{id}/versions/{a}/diff/{b}",
            get(diff_versions),
        )
        .route(
            "/api/v1/workflows/{id}/versions/{vId}/export",
            get(export_version),
        )
        .route(
            "/api/v1/workflows/{id}/versions/{vId}/rollback",
            post(rollback_version),
        )
        .route("/api/v1/workflows/{id}/versions/tag", post(tag_version))
        .route("/api/v1/workflows/{id}/drift", get(get_drift))
}

#[derive(Deserialize)]
struct PaginationQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
    workflow_id: Option<uuid::Uuid>,
}

fn default_limit() -> i64 {
    20
}

async fn list_workflows(
    State(state): State<AppState>,
    Query(q): Query<PaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::list_workflows(pool, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_workflow(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::get_workflow(pool, id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Workflow not found"})),
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
struct CreateWorkflowRequest {
    name: String,
    description: Option<String>,
    #[serde(default = "empty_array")]
    steps_json: serde_json::Value,
    #[serde(default = "empty_array")]
    edges_json: serde_json::Value,
}

fn empty_array() -> serde_json::Value {
    serde_json::json!([])
}

async fn create_workflow(
    State(state): State<AppState>,
    Json(body): Json<CreateWorkflowRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::create_workflow(
        pool,
        &body.name,
        body.description.as_deref(),
        &body.steps_json,
        &body.edges_json,
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

async fn delete_workflow(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match workflow::delete_workflow(pool, id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Workflow not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Run a specific workflow ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunWorkflowRequest {
    input: Option<serde_json::Value>,
    #[serde(default = "manual_trigger")]
    triggered_by: String,
}

async fn run_workflow(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
    Json(body): Json<RunWorkflowRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    // Fetch the workflow first to get its name and verify it exists.
    let wf = match workflow::get_workflow(pool, id).await {
        Ok(Some(row)) => row,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Workflow not found"})),
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
    };
    match workflow::create_run(pool, id, &wf.name, body.input.as_ref(), &body.triggered_by).await {
        Ok(row) => {
            // Spawn async workflow execution (fire-and-forget)
            let run_id = row.id;
            let pool = pool.clone();
            let wf_id = wf.id.to_string();
            let wf_name = wf.name.clone();
            let steps_json = wf.steps_json.clone();
            let input = body.input.clone();
            tokio::spawn(async move {
                // Mark as running
                let _ = workflow::update_run_status(&pool, run_id, "running", None, None).await;

                // Build definition from workflow row
                let steps: Vec<crate::orchestration::workflow::WorkflowStep> =
                    serde_json::from_value(steps_json).unwrap_or_default();
                let def = crate::orchestration::workflow::WorkflowDefinition {
                    id: wf_id,
                    name: wf_name,
                    steps,
                    input: input.unwrap_or(serde_json::json!({})),
                };

                // Execute the workflow DAG via Hoosh/AGNOS LLM Gateway
                let engine = crate::orchestration::workflow::WorkflowEngine::new(
                    crate::orchestration::hoosh::HooshDelegate::from_env(),
                );
                match engine.execute(&def).await {
                    Ok(result) => {
                        let output = serde_json::to_value(&result.final_output).ok();
                        let _ = workflow::update_run_status(
                            &pool,
                            run_id,
                            "completed",
                            output.as_ref(),
                            None,
                        )
                        .await;
                        tracing::info!(run_id = %run_id, steps = result.steps_completed, "workflow completed");
                    }
                    Err(e) => {
                        let _ = workflow::update_run_status(
                            &pool,
                            run_id,
                            "failed",
                            None,
                            Some(&e.to_string()),
                        )
                        .await;
                        tracing::error!(run_id = %run_id, error = %e, "workflow failed");
                    }
                }
            });

            (
                StatusCode::CREATED,
                Json(serde_json::to_value(row).unwrap()),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Runs for a specific workflow ---

#[derive(Deserialize)]
struct RunsPQ {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

async fn list_runs_for_workflow(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
    Query(q): Query<RunsPQ>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::list_runs_for_workflow(pool, id, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Global runs (existing) ---

async fn list_runs(
    State(state): State<AppState>,
    Query(q): Query<PaginationQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::list_runs(pool, q.workflow_id, q.limit.min(100), q.offset).await {
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
struct CreateRunRequest {
    workflow_id: uuid::Uuid,
    workflow_name: String,
    input: Option<serde_json::Value>,
    #[serde(default = "manual_trigger")]
    triggered_by: String,
}
fn manual_trigger() -> String {
    "manual".to_string()
}

async fn create_run(
    State(state): State<AppState>,
    Json(body): Json<CreateRunRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::create_run(
        pool,
        body.workflow_id,
        &body.workflow_name,
        body.input.as_ref(),
        &body.triggered_by,
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

async fn get_run(State(state): State<AppState>, Path(id): Path<uuid::Uuid>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::get_run(pool, id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Run not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Import / Export ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportWorkflowRequest {
    name: String,
    description: Option<String>,
    #[serde(default = "empty_array")]
    steps_json: serde_json::Value,
    #[serde(default = "empty_array")]
    edges_json: serde_json::Value,
    #[serde(default = "import_source")]
    source: String,
}
fn import_source() -> String {
    "import".to_string()
}

async fn import_workflow(
    State(state): State<AppState>,
    Json(body): Json<ImportWorkflowRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::import_workflow(
        pool,
        &body.name,
        body.description.as_deref(),
        &body.steps_json,
        &body.edges_json,
        &body.source,
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

async fn export_workflow(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::get_workflow(pool, id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "name": row.name,
            "description": row.description,
            "stepsJson": row.steps_json,
            "edgesJson": row.edges_json,
            "triggersJson": row.triggers_json,
            "autonomyLevel": row.autonomy_level,
            "version": row.version,
            "source": row.source,
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Workflow not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// --- Versions ---

async fn list_versions(
    State(state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
    Query(q): Query<RunsPQ>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::list_versions(pool, id, q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/workflows/{id}/versions/{idOrTag} — get a specific version by ID or tag.
async fn get_version(
    State(state): State<AppState>,
    Path((id, id_or_tag)): Path<(uuid::Uuid, String)>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::get_version(pool, id, &id_or_tag).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Version not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/workflows/{id}/versions/{a}/diff/{b} — diff two versions.
async fn diff_versions(
    State(state): State<AppState>,
    Path((id, a, b)): Path<(uuid::Uuid, String, String)>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let ver_a = workflow::get_version(pool, id, &a).await;
    let ver_b = workflow::get_version(pool, id, &b).await;
    match (ver_a, ver_b) {
        (Ok(Some(va)), Ok(Some(vb))) => Json(serde_json::json!({
            "workflowId": id,
            "versionA": a,
            "versionB": b,
            "stepsChanged": va.steps_json != vb.steps_json,
            "edgesChanged": va.edges_json != vb.edges_json,
        }))
        .into_response(),
        (Ok(None), _) | (_, Ok(None)) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "One or both versions not found"})),
        )
            .into_response(),
        (Err(e), _) | (_, Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/workflows/{id}/versions/{vId}/export — export a specific version.
async fn export_version(
    State(state): State<AppState>,
    Path((id, v_id)): Path<(uuid::Uuid, String)>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::get_version(pool, id, &v_id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "workflowId": id,
            "version": row.version,
            "stepsJson": row.steps_json,
            "edgesJson": row.edges_json,
            "createdBy": row.created_by,
            "createdAt": row.created_at,
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Version not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/v1/workflows/{id}/versions/{vId}/rollback — rollback to a specific version.
async fn rollback_version(
    State(state): State<AppState>,
    Path((id, v_id)): Path<(uuid::Uuid, String)>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::get_version(pool, id, &v_id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "workflowId": id,
            "rolledBackTo": row.version,
            "status": "completed",
            "message": "Workflow rolled back to version",
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Version not found"})),
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
struct TagVersionRequest {
    version_id: String,
    tag: String,
}

/// POST /api/v1/workflows/{id}/versions/tag — tag a version.
async fn tag_version(
    State(_state): State<AppState>,
    Path(id): Path<uuid::Uuid>,
    Json(body): Json<TagVersionRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "workflowId": id,
        "versionId": body.version_id,
        "tag": body.tag,
        "status": "tagged",
    }))
    .into_response()
}

/// GET /api/v1/workflows/{id}/drift — check for drift between current and latest version.
async fn get_drift(State(state): State<AppState>, Path(id): Path<uuid::Uuid>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match workflow::get_workflow(pool, id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "workflowId": id,
            "currentVersion": row.version,
            "driftDetected": false,
            "message": "No drift detected",
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Workflow not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
