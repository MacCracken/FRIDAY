//! Multimodal routes — vision, audio, TTS, image generation, haptic,
//! config, vocabulary, Polly voices/lexicons.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::multimodal;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // ── Provider / model config ──
        .route("/api/v1/multimodal/provider", patch(update_provider_config))
        .route("/api/v1/multimodal/model", patch(update_model_config))
        .route("/api/v1/multimodal/config", get(get_multimodal_config))
        // ── Vision ──
        .route("/api/v1/multimodal/vision/analyze", post(analyze_image))
        // ── Audio ──
        .route(
            "/api/v1/multimodal/audio/transcribe",
            post(transcribe_audio),
        )
        .route("/api/v1/multimodal/audio/speak", post(text_to_speech))
        .route(
            "/api/v1/multimodal/audio/speak/stream",
            post(text_to_speech_stream),
        )
        // ── Image generation ──
        .route("/api/v1/multimodal/image/generate", post(generate_image))
        // ── Haptic ──
        .route("/api/v1/multimodal/haptic/trigger", post(trigger_haptic))
        // ── Jobs ──
        .route("/api/v1/multimodal/jobs", get(list_jobs))
        // ── Vocabulary ──
        .route(
            "/api/v1/multimodal/transcribe/vocabulary",
            post(add_vocabulary),
        )
        .route(
            "/api/v1/multimodal/transcribe/vocabulary",
            get(list_vocabularies),
        )
        .route(
            "/api/v1/multimodal/transcribe/vocabulary/{name}",
            delete(delete_vocabulary),
        )
        // ── Polly ──
        .route("/api/v1/multimodal/polly/voices", get(list_polly_voices))
        .route(
            "/api/v1/multimodal/polly/lexicons",
            get(list_polly_lexicons),
        )
        .route(
            "/api/v1/multimodal/polly/lexicons",
            post(create_polly_lexicon),
        )
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
// Provider / model config
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProviderRequest {
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    region: Option<String>,
    #[serde(default)]
    config: serde_json::Value,
}

async fn update_provider_config(
    State(_s): State<AppState>,
    Json(_body): Json<UpdateProviderRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({"status": "updated", "stub": true}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateModelRequest {
    #[serde(default)]
    model_id: Option<String>,
    #[serde(default)]
    config: serde_json::Value,
}

async fn update_model_config(
    State(_s): State<AppState>,
    Json(_body): Json<UpdateModelRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({"status": "updated", "stub": true}))
}

async fn get_multimodal_config(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "provider": null,
        "region": null,
        "visionModel": null,
        "speechModel": null,
        "ttsModel": null,
        "imageModel": null,
        "stub": true
    }))
}

// ============================================================
// Vision — compute stub
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeImageRequest {
    #[serde(default)]
    image_url: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
}

async fn analyze_image(
    State(_s): State<AppState>,
    Json(_body): Json<AnalyzeImageRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "description": null,
        "labels": [],
        "stub": true
    }))
}

// ============================================================
// Audio — compute stubs
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeRequest {
    #[serde(default)]
    audio_url: Option<String>,
    #[serde(default)]
    language_code: Option<String>,
}

async fn transcribe_audio(
    State(_s): State<AppState>,
    Json(_body): Json<TranscribeRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "transcript": null,
        "confidence": null,
        "stub": true
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TtsRequest {
    text: String,
    #[serde(default)]
    voice_id: Option<String>,
    #[serde(default)]
    output_format: Option<String>,
}

async fn text_to_speech(
    State(_s): State<AppState>,
    Json(_body): Json<TtsRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "audioUrl": null,
        "durationMs": null,
        "stub": true
    }))
}

async fn text_to_speech_stream(
    State(_s): State<AppState>,
    Json(_body): Json<TtsRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "streamUrl": null,
        "stub": true
    }))
}

// ============================================================
// Image generation — compute stub
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateImageRequest {
    prompt: String,
    #[serde(default)]
    negative_prompt: Option<String>,
    #[serde(default)]
    width: Option<i64>,
    #[serde(default)]
    height: Option<i64>,
}

async fn generate_image(
    State(_s): State<AppState>,
    Json(_body): Json<GenerateImageRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "imageUrl": null,
        "seed": null,
        "stub": true
    }))
}

// ============================================================
// Haptic — compute stub
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HapticRequest {
    #[serde(default)]
    pattern: Option<String>,
    #[serde(default)]
    intensity: Option<f64>,
    #[serde(default)]
    duration_ms: Option<i64>,
}

async fn trigger_haptic(
    State(_s): State<AppState>,
    Json(_body): Json<HapticRequest>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "triggered",
        "stub": true
    }))
}

// ============================================================
// Jobs
// ============================================================

async fn list_jobs(State(_s): State<AppState>, Query(_q): Query<PQ>) -> impl IntoResponse {
    Json(serde_json::json!({
        "items": [],
        "total": 0,
        "stub": true
    }))
}

// ============================================================
// Vocabulary (DB-backed)
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddVocabularyRequest {
    name: String,
    #[serde(default = "empty_array")]
    phrases: serde_json::Value,
}

fn empty_array() -> serde_json::Value {
    serde_json::json!([])
}

async fn add_vocabulary(
    State(s): State<AppState>,
    Json(body): Json<AddVocabularyRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match multimodal::create_vocabulary(pool, &id, "default", &body.name, &body.phrases).await {
        Ok(r) => (StatusCode::CREATED, Json(serde_json::to_value(r).unwrap())).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn list_vocabularies(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return no_db().into_response();
    };
    match multimodal::list_vocabularies(pool, "default", q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

async fn delete_vocabulary(
    State(s): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match multimodal::delete_vocabulary_by_name(pool, "default", &name).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Vocabulary not found").into_response(),
        Err(e) => db_err(e).into_response(),
    }
}

// ============================================================
// Polly (stubs — proxied to AWS)
// ============================================================

async fn list_polly_voices(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "voices": [],
        "stub": true
    }))
}

async fn list_polly_lexicons(State(_s): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "lexicons": [],
        "stub": true
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateLexiconRequest {
    name: String,
    content: String,
}

async fn create_polly_lexicon(
    State(_s): State<AppState>,
    Json(_body): Json<CreateLexiconRequest>,
) -> impl IntoResponse {
    (
        StatusCode::CREATED,
        Json(serde_json::json!({"status": "created", "stub": true})),
    )
}
