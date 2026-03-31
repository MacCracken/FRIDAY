//! Todoist proxy routes — REST API v2.
//!
//! Credentials: Bearer token from integration config `apiToken` field.
//! All routes under /api/v1/integrations/todoist/.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::integrations::proxy::{self, AuthMode};
use crate::state::AppState;

const TODOIST_API: &str = "https://api.todoist.com/rest/v2";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/integrations/todoist/tasks", get(list_tasks))
        .route("/api/v1/integrations/todoist/tasks", post(create_task))
        .route("/api/v1/integrations/todoist/tasks/{taskId}", get(get_task))
        .route(
            "/api/v1/integrations/todoist/tasks/{taskId}",
            put(update_task),
        )
        .route(
            "/api/v1/integrations/todoist/tasks/{taskId}/close",
            post(close_task),
        )
        .route("/api/v1/integrations/todoist/projects", get(list_projects))
}

async fn resolve_token(
    state: &AppState,
) -> Result<AuthMode, (StatusCode, Json<serde_json::Value>)> {
    let pool = state.db().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    ))?;
    let token = proxy::resolve_bearer_token(pool, "todoist", "apiToken").await?;
    Ok(AuthMode::Bearer(token))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TasksQuery {
    project_id: Option<String>,
    filter: Option<String>,
}

async fn list_tasks(
    State(state): State<AppState>,
    Query(q): Query<TasksQuery>,
) -> impl IntoResponse {
    let auth = match resolve_token(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let mut params = Vec::new();
    if let Some(ref pid) = q.project_id {
        params.push(format!("project_id={pid}"));
    }
    if let Some(ref f) = q.filter {
        params.push(format!(
            "filter={}",
            f.replace(' ', "%20").replace('&', "%26")
        ));
    }
    let qs = if params.is_empty() {
        None
    } else {
        Some(params.join("&"))
    };
    proxy::proxy_get(TODOIST_API, "/tasks", &auth, qs.as_deref())
        .await
        .into_response()
}

async fn get_task(State(state): State<AppState>, Path(task_id): Path<String>) -> impl IntoResponse {
    let auth = match resolve_token(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_get(TODOIST_API, &format!("/tasks/{task_id}"), &auth, None)
        .await
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskBody {
    content: String,
    description: Option<String>,
    project_id: Option<String>,
    due_string: Option<String>,
    priority: Option<u8>,
}

async fn create_task(
    State(state): State<AppState>,
    Json(body): Json<CreateTaskBody>,
) -> impl IntoResponse {
    let auth = match resolve_token(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let mut payload = serde_json::json!({"content": body.content});
    if let Some(d) = &body.description {
        payload["description"] = serde_json::json!(d);
    }
    if let Some(p) = &body.project_id {
        payload["project_id"] = serde_json::json!(p);
    }
    if let Some(d) = &body.due_string {
        payload["due_string"] = serde_json::json!(d);
    }
    if let Some(p) = body.priority {
        payload["priority"] = serde_json::json!(p);
    }
    proxy::proxy_post(TODOIST_API, "/tasks", &auth, &payload)
        .await
        .into_response()
}

async fn update_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let auth = match resolve_token(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    // Todoist v2 uses POST for updates
    proxy::proxy_post(TODOIST_API, &format!("/tasks/{task_id}"), &auth, &body)
        .await
        .into_response()
}

async fn close_task(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> impl IntoResponse {
    let auth = match resolve_token(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_post(
        TODOIST_API,
        &format!("/tasks/{task_id}/close"),
        &auth,
        &serde_json::json!({}),
    )
    .await
    .into_response()
}

async fn list_projects(State(state): State<AppState>) -> impl IntoResponse {
    let auth = match resolve_token(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_get(TODOIST_API, "/projects", &auth, None)
        .await
        .into_response()
}
