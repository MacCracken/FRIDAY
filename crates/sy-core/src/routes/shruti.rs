//! Shruti routes — proxy voice commands to the Shruti DAW service.
//!
//! Env: SHRUTI_URL (default http://localhost:8050)

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/shruti/voice/command", post(voice_command))
        .route("/api/v1/shruti/voice/parse", post(voice_parse))
}

fn shruti_url() -> String {
    std::env::var("SHRUTI_URL").unwrap_or_else(|_| "http://localhost:8050".to_string())
}

async fn proxy_to_shruti(path: &str, body: serde_json::Value) -> axum::response::Response {
    let url = format!("{}{path}", shruti_url());
    let client = reqwest::Client::new();
    match client.post(&url).json(&body).send().await {
        Ok(res) if res.status().is_success() => {
            let data: serde_json::Value = res.json().await.unwrap_or(serde_json::json!(null));
            (StatusCode::OK, Json(data)).into_response()
        }
        Ok(res) => {
            let s = res.status().as_u16();
            let text = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": text})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn voice_command(Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    proxy_to_shruti("/api/voice/command", body).await
}

async fn voice_parse(Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    proxy_to_shruti("/api/voice/parse", body).await
}
