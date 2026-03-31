//! Photisnadi proxy routes — Supabase dashboard widget data.
//!
//! Env: PHOTISNADI_SUPABASE_URL, PHOTISNADI_SUPABASE_KEY, PHOTISNADI_USER_ID.

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/integrations/photisnadi/widget", get(widget_data))
        .route("/api/v1/integrations/photisnadi/health", get(health))
}

fn get_config() -> Option<(String, String, String)> {
    let url = std::env::var("PHOTISNADI_SUPABASE_URL").ok()?;
    let key = std::env::var("PHOTISNADI_SUPABASE_KEY").ok()?;
    let user_id = std::env::var("PHOTISNADI_USER_ID").ok()?;
    Some((url.trim_end_matches('/').to_string(), key, user_id))
}

async fn supabase_query(
    base_url: &str,
    key: &str,
    table: &str,
    params: &str,
) -> Result<serde_json::Value, String> {
    let url = format!("{base_url}/rest/v1/{table}?{params}");
    let res = reqwest::Client::new()
        .get(&url)
        .header("apikey", key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Supabase error: HTTP {}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

async fn widget_data() -> impl IntoResponse {
    let Some((url, key, user_id)) = get_config() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Photisnadi not configured"})),
        )
            .into_response();
    };
    let tasks = supabase_query(
        &url,
        &key,
        "tasks",
        &format!("user_id=eq.{user_id}&select=id,status"),
    )
    .await;
    let rituals = supabase_query(
        &url,
        &key,
        "rituals",
        &format!("user_id=eq.{user_id}&select=id,streak"),
    )
    .await;
    match (tasks, rituals) {
        (Ok(t), Ok(r)) => Json(serde_json::json!({"tasks": t, "rituals": r})).into_response(),
        (Err(e), _) | (_, Err(e)) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": e})),
        )
            .into_response(),
    }
}

async fn health() -> impl IntoResponse {
    let configured = get_config().is_some();
    Json(serde_json::json!({"configured": configured}))
}
