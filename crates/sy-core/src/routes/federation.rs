//! Federation routes — peer node management, health, and federated learning.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::federation;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // Existing peer management
        .route("/api/v1/federation/peers", get(list_peers))
        .route("/api/v1/federation/peers", post(create_peer))
        .route("/api/v1/federation/peers/{id}", delete(delete_peer))
        .route(
            "/api/v1/federation/peers/{id}/features",
            put(update_peer_features),
        )
        .route(
            "/api/v1/federation/peers/{id}/health",
            post(peer_health_check),
        )
        // Federated learning — sessions
        .route("/api/v1/federated/sessions", get(list_federated_sessions))
        .route("/api/v1/federated/sessions", post(create_federated_session))
        .route(
            "/api/v1/federated/sessions/{sessionId}",
            get(get_federated_session),
        )
        .route(
            "/api/v1/federated/sessions/{sessionId}/pause",
            post(pause_federated_session),
        )
        .route(
            "/api/v1/federated/sessions/{sessionId}/resume",
            post(resume_federated_session),
        )
        .route(
            "/api/v1/federated/sessions/{sessionId}/cancel",
            post(cancel_federated_session),
        )
        // Federated learning — participants
        .route(
            "/api/v1/federated/participants",
            get(list_federated_participants),
        )
        .route(
            "/api/v1/federated/participants",
            post(register_federated_participant),
        )
        .route(
            "/api/v1/federated/participants/{participantId}/heartbeat",
            post(participant_heartbeat),
        )
        // Federated learning — rounds
        .route(
            "/api/v1/federated/sessions/{sessionId}/rounds",
            get(list_session_rounds),
        )
        .route(
            "/api/v1/federated/sessions/{sessionId}/rounds",
            post(create_session_round),
        )
        .route("/api/v1/federated/rounds/{roundId}", get(get_round))
        // Federated learning — model updates
        .route(
            "/api/v1/federated/rounds/{roundId}/updates",
            post(submit_model_update),
        )
        .route(
            "/api/v1/federated/rounds/{roundId}/updates",
            get(list_round_updates),
        )
        .route(
            "/api/v1/federated/rounds/{roundId}/aggregate",
            post(aggregate_round),
        )
        // Personality import from federated peers
        .route(
            "/api/v1/federation/personalities/import",
            post(import_personality),
        )
}

async fn list_peers(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match federation::list_peers(pool).await {
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
struct CreatePeerRequest {
    name: String,
    endpoint: String,
    #[serde(default = "default_trust_level")]
    trust_level: String,
}

fn default_trust_level() -> String {
    "untrusted".to_string()
}

async fn create_peer(
    State(state): State<AppState>,
    Json(body): Json<CreatePeerRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match federation::create_peer(pool, &id, &body.name, &body.endpoint, &body.trust_level).await {
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

async fn delete_peer(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match federation::delete_peer(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Peer not found"})),
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
struct UpdateFeaturesRequest {
    features: serde_json::Value,
}

async fn update_peer_features(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateFeaturesRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match federation::update_peer_features(pool, &id, &body.features).await {
        Ok(true) => Json(serde_json::json!({"id": id, "features": body.features})).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Peer not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn peer_health_check(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match federation::update_peer_health(pool, &id).await {
        Ok(true) => Json(serde_json::json!({"id": id, "status": "healthy"})).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Peer not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ============================================================
// Shared helpers
// ============================================================

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    20
}

fn no_db() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
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

fn empty_obj() -> serde_json::Value {
    serde_json::json!({})
}

// ============================================================
// Federated learning — sessions
// ============================================================

async fn list_federated_sessions(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match federation::list_federated_sessions(pool, "default", q.limit.min(100), q.offset).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_federated_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match federation::get_federated_session(pool, &session_id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Federated session not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateFederatedSessionRequest {
    name: String,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_federated_session(
    State(state): State<AppState>,
    Json(body): Json<CreateFederatedSessionRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match federation::create_federated_session(pool, &id, "default", &body.name, &body.config).await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn pause_federated_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match federation::update_federated_session_status(pool, &session_id, "paused").await {
        Ok(true) => Json(serde_json::json!({"id": session_id, "status": "paused"})).into_response(),
        Ok(false) => not_found("Federated session not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn resume_federated_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match federation::update_federated_session_status(pool, &session_id, "running").await {
        Ok(true) => {
            Json(serde_json::json!({"id": session_id, "status": "running"})).into_response()
        }
        Ok(false) => not_found("Federated session not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn cancel_federated_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match federation::update_federated_session_status(pool, &session_id, "cancelled").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Federated session not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Federated learning — participants
// ============================================================

async fn list_federated_participants(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match federation::list_federated_participants(pool, "default", q.limit.min(100), q.offset).await
    {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterParticipantRequest {
    name: String,
    #[serde(default = "empty_obj")]
    metadata: serde_json::Value,
}

async fn register_federated_participant(
    State(state): State<AppState>,
    Json(body): Json<RegisterParticipantRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match federation::register_federated_participant(
        pool,
        &id,
        "default",
        &body.name,
        &body.metadata,
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn participant_heartbeat(
    State(state): State<AppState>,
    Path(participant_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match federation::participant_heartbeat(pool, &participant_id).await {
        Ok(true) => {
            Json(serde_json::json!({"id": participant_id, "status": "active"})).into_response()
        }
        Ok(false) => not_found("Participant not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Federated learning — rounds
// ============================================================

async fn list_session_rounds(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match federation::list_session_rounds(pool, &session_id).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRoundRequest {
    round_number: i32,
    #[serde(default = "empty_obj")]
    config: serde_json::Value,
}

async fn create_session_round(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(body): Json<CreateRoundRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match federation::create_session_round(pool, &id, &session_id, body.round_number, &body.config)
        .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn get_round(
    State(state): State<AppState>,
    Path(round_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match federation::get_round(pool, &round_id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => not_found("Round not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Federated learning — model updates
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmitUpdateRequest {
    participant_id: String,
    #[serde(default = "empty_obj")]
    update_data: serde_json::Value,
}

async fn submit_model_update(
    State(state): State<AppState>,
    Path(round_id): Path<String>,
    Json(body): Json<SubmitUpdateRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match federation::submit_model_update(
        pool,
        &id,
        &round_id,
        &body.participant_id,
        &body.update_data,
    )
    .await
    {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::to_value(row).unwrap()),
        )
            .into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_round_updates(
    State(state): State<AppState>,
    Path(round_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return no_db().into_response();
    };
    match federation::list_round_updates(pool, &round_id).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn aggregate_round(
    State(state): State<AppState>,
    Path(round_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match federation::aggregate_round(pool, &round_id).await {
        Ok(true) => {
            Json(serde_json::json!({"roundId": round_id, "status": "aggregated"})).into_response()
        }
        Ok(false) => not_found("Round not found or not aggregatable").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn import_personality(
    State(_state): State<AppState>,
    Json(_body): Json<serde_json::Value>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "queued",
        "message": "Personality import queued for processing",
    }))
}
