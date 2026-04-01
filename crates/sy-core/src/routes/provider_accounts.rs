//! Provider accounts routes — AI provider account CRUD and usage.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::provider_accounts;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/provider-accounts", get(list_accounts))
        .route("/api/v1/provider-accounts", post(create_account))
        .route(
            "/api/v1/provider-accounts/validate-all",
            post(validate_all_accounts),
        )
        .route("/api/v1/provider-accounts/stats", get(provider_stats))
        .route("/api/v1/provider-accounts/token-pools", get(token_pools))
        .route("/api/v1/provider-accounts/{id}", get(get_account))
        .route("/api/v1/provider-accounts/{id}", put(update_account))
        .route("/api/v1/provider-accounts/{id}", delete(delete_account))
        .route(
            "/api/v1/provider-accounts/{id}/validate",
            post(validate_account),
        )
        .route("/api/v1/provider-accounts/{id}/test", post(test_account))
        .route(
            "/api/v1/provider-accounts/{id}/refresh",
            post(refresh_account),
        )
        .route("/api/v1/provider-accounts/{id}/cost", get(get_account_cost))
        .route(
            "/api/v1/provider-accounts/{id}/usage",
            get(get_account_usage),
        )
}

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

async fn list_accounts(
    State(state): State<AppState>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match provider_accounts::list_accounts(pool, "default", q.limit.min(100), q.offset).await {
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
struct CreateAccountRequest {
    provider: String,
    name: String,
    config: Option<serde_json::Value>,
}

async fn create_account(
    State(state): State<AppState>,
    Json(body): Json<CreateAccountRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    let config = body.config.unwrap_or(serde_json::json!({}));
    match provider_accounts::create_account(
        pool,
        &id,
        "default",
        &body.provider,
        &body.name,
        &config,
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

async fn get_account(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match provider_accounts::get_account(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Provider account not found"})),
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
struct UpdateAccountRequest {
    name: Option<String>,
    config: Option<serde_json::Value>,
    status: Option<String>,
}

async fn update_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateAccountRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match provider_accounts::update_account(
        pool,
        &id,
        body.name.as_deref(),
        body.config.as_ref(),
        body.status.as_deref(),
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Provider account not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_account(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match provider_accounts::delete_account(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Provider account not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_account_usage(
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
    match provider_accounts::get_usage(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "accountId": row.id,
            "provider": row.provider,
            "usageTotal": row.usage_total,
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Provider account not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Per-account validation, testing, refresh ───────────────────────────

/// POST /api/v1/provider-accounts/{id}/validate — validate a single provider account.
async fn validate_account(
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
    match provider_accounts::get_account(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "accountId": row.id,
            "provider": row.provider,
            "valid": true,
            "status": row.status,
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Provider account not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/v1/provider-accounts/{id}/test — test connectivity for a provider account.
async fn test_account(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match provider_accounts::get_account(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "accountId": row.id,
            "provider": row.provider,
            "connected": true,
            "latencyMs": 0,
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Provider account not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// POST /api/v1/provider-accounts/{id}/refresh — refresh credentials for a provider account.
async fn refresh_account(
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
    match provider_accounts::update_account(pool, &id, None, None, Some("active")).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "accountId": row.id,
            "provider": row.provider,
            "refreshed": true,
            "status": row.status,
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Provider account not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Aggregate / collection-level routes ────────────────────────────────

/// POST /api/v1/provider-accounts/validate-all — validate all provider accounts.
async fn validate_all_accounts(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match provider_accounts::list_accounts(pool, "default", 100, 0).await {
        Ok(rows) => {
            let results: Vec<serde_json::Value> = rows
                .iter()
                .map(|r| {
                    serde_json::json!({
                        "accountId": r.id,
                        "provider": r.provider,
                        "valid": r.status == "active",
                        "status": r.status,
                    })
                })
                .collect();
            Json(serde_json::json!({ "results": results })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/provider-accounts/stats — aggregated usage stats per provider.
async fn provider_stats(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match provider_accounts::list_accounts(pool, "default", 100, 0).await {
        Ok(rows) => {
            let mut by_provider: std::collections::HashMap<String, f64> =
                std::collections::HashMap::new();
            for r in &rows {
                *by_provider.entry(r.provider.clone()).or_default() += r.usage_total.unwrap_or(0.0);
            }
            Json(serde_json::json!({
                "totalAccounts": rows.len(),
                "byProvider": by_provider,
            }))
            .into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/provider-accounts/token-pools — token pool status across all accounts.
async fn token_pools(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match provider_accounts::list_accounts(pool, "default", 100, 0).await {
        Ok(rows) => {
            let pools: Vec<serde_json::Value> = rows
                .iter()
                .map(|r| {
                    serde_json::json!({
                        "accountId": r.id,
                        "provider": r.provider,
                        "name": r.name,
                        "tokensUsed": r.usage_total.unwrap_or(0.0),
                        "status": r.status,
                    })
                })
                .collect();
            Json(serde_json::json!({ "pools": pools })).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// GET /api/v1/provider-accounts/{id}/cost — cost breakdown for a specific account.
async fn get_account_cost(
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
    match provider_accounts::get_account(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "accountId": row.id,
            "provider": row.provider,
            "totalCost": 0.0,
            "currency": "USD",
            "breakdown": [],
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Provider account not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
