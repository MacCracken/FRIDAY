//! Eval routes — agent evaluation harness: scenarios, suites, runs.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::eval;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // ── Scenarios ──
        .route("/api/v1/eval/scenarios", get(list_scenarios))
        .route("/api/v1/eval/scenarios", post(create_scenario))
        .route("/api/v1/eval/scenarios/{id}", get(get_scenario))
        .route("/api/v1/eval/scenarios/{id}", put(update_scenario))
        .route("/api/v1/eval/scenarios/{id}", delete(delete_scenario))
        .route("/api/v1/eval/scenarios/{id}/run", post(run_scenario))
        // ── Suites ──
        .route("/api/v1/eval/suites", get(list_suites))
        .route("/api/v1/eval/suites", post(create_suite))
        .route("/api/v1/eval/suites/{id}", get(get_suite))
        .route("/api/v1/eval/suites/{id}", delete(delete_suite))
        .route("/api/v1/eval/suites/{id}/run", post(run_suite))
        // ── Runs ──
        .route("/api/v1/eval/runs", get(list_runs))
        .route("/api/v1/eval/runs/{id}", get(get_run))
}

// ============================================================
// Shared helpers
// ============================================================

#[derive(Deserialize)]
struct PQ {
    #[serde(default = "dl")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}
fn dl() -> i64 {
    20
}

fn no_db() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "No DB"})),
    )
}

fn db_err(e: sqlx::Error) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"error": e.to_string()})),
    )
}

fn not_found(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"error": msg})),
    )
}

// ============================================================
// Scenarios
// ============================================================

async fn list_scenarios(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match eval::list_scenarios(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_scenario(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match eval::get_scenario(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Scenario not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateScenarioRequest {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default = "empty_array")]
    steps: serde_json::Value,
}

fn empty_array() -> serde_json::Value {
    serde_json::json!([])
}

async fn create_scenario(
    State(s): State<AppState>,
    Json(body): Json<CreateScenarioRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match eval::create_scenario(
        pool,
        &id,
        "default",
        &body.name,
        body.description.as_deref(),
        &body.steps,
    )
    .await
    {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateScenarioRequest {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default = "empty_array")]
    steps: serde_json::Value,
}

async fn update_scenario(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateScenarioRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match eval::update_scenario(
        pool,
        &id,
        &body.name,
        body.description.as_deref(),
        &body.steps,
    )
    .await
    {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Scenario not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_scenario(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match eval::delete_scenario(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Scenario not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn run_scenario(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    // Verify scenario exists, then create a run record
    match eval::get_scenario(pool, &id).await {
        Ok(None) => return not_found("Scenario not found").into_response(),
        Err(e) => return db_err(e).into_response(),
        Ok(Some(_)) => {}
    }
    let run_id = uuid::Uuid::now_v7().to_string();
    match eval::create_run(pool, &run_id, "default", "scenario", &id).await {
        Ok(r) => (StatusCode::ACCEPTED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Suites
// ============================================================

async fn list_suites(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match eval::list_suites(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_suite(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match eval::get_suite(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Suite not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSuiteRequest {
    name: String,
    #[serde(default = "empty_array")]
    scenario_ids: serde_json::Value,
}

async fn create_suite(
    State(s): State<AppState>,
    Json(body): Json<CreateSuiteRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match eval::create_suite(pool, &id, "default", &body.name, &body.scenario_ids).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_suite(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match eval::delete_suite(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Suite not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn run_suite(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match eval::get_suite(pool, &id).await {
        Ok(None) => return not_found("Suite not found").into_response(),
        Err(e) => return db_err(e).into_response(),
        Ok(Some(_)) => {}
    }
    let run_id = uuid::Uuid::now_v7().to_string();
    match eval::create_run(pool, &run_id, "default", "suite", &id).await {
        Ok(r) => (StatusCode::ACCEPTED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Runs
// ============================================================

async fn list_runs(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match eval::list_runs(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_run(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match eval::get_run(pool, &id).await {
        Ok(Some(r)) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Ok(None) => not_found("Run not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}
