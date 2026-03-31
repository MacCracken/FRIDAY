//! Auth routes — login, refresh, logout, token management.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::auth::jwt::{issue_access_token, issue_refresh_token, validate_token};
use crate::db::auth;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/refresh", post(refresh))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/me", get(me))
        // API keys
        .route("/api/v1/auth/api-keys", get(list_api_keys))
        .route("/api/v1/auth/api-keys", post(create_api_key))
        .route("/api/v1/auth/api-keys/{id}", delete(revoke_api_key))
        // Users
        .route("/api/v1/auth/users", get(list_users))
        .route("/api/v1/auth/users", post(create_user))
        .route("/api/v1/auth/users/{id}", put(update_user_role))
        // Settings
        .route("/api/v1/auth/settings", get(get_auth_settings))
}

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
    #[serde(default)]
    remember_me: bool,
}

async fn login(State(state): State<AppState>, Json(body): Json<LoginRequest>) -> impl IntoResponse {
    if body.password.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Password must be at least 8 characters"})),
        )
            .into_response();
    }

    // Verify password against configured admin password
    let admin_password = std::env::var("SECUREYEOMAN_ADMIN_PASSWORD").unwrap_or_default();

    if admin_password.is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "No admin password configured"})),
        )
            .into_response();
    }

    // Constant-time comparison
    let pw_bytes = body.password.as_bytes();
    let admin_bytes = admin_password.as_bytes();
    let matches = pw_bytes.len() == admin_bytes.len()
        && pw_bytes
            .iter()
            .zip(admin_bytes.iter())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0;

    if !matches {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Invalid credentials"})),
        )
            .into_response();
    }

    let jwt_config = state.jwt_config();
    let permissions = vec!["*:*".to_string()];

    let access_token = match issue_access_token(jwt_config, "admin", "admin", &permissions) {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Token generation failed: {e}")})),
            )
                .into_response();
        }
    };

    let refresh_token = match issue_refresh_token(jwt_config, "admin", "admin") {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Token generation failed: {e}")})),
            )
                .into_response();
        }
    };

    let expires_in = if body.remember_me {
        3600 // 1 hour
    } else {
        jwt_config.access_token_expiry_secs
    };

    Json(serde_json::json!({
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "expiresIn": expires_in,
        "tokenType": "Bearer",
    }))
    .into_response()
}

#[derive(Deserialize)]
struct RefreshRequest {
    refresh_token: String,
}

async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> impl IntoResponse {
    let jwt_config = state.jwt_config();
    let claims = match validate_token(jwt_config, &body.refresh_token) {
        Ok(c) if c.token_type == "refresh" => c,
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "Invalid refresh token"})),
            )
                .into_response();
        }
    };

    let permissions = claims.permissions;
    let access_token = match issue_access_token(jwt_config, &claims.sub, &claims.role, &permissions)
    {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Token generation failed: {e}")})),
            )
                .into_response();
        }
    };

    Json(serde_json::json!({
        "accessToken": access_token,
        "expiresIn": jwt_config.access_token_expiry_secs,
        "tokenType": "Bearer",
    }))
    .into_response()
}

async fn logout() -> impl IntoResponse {
    // TODO: Add JTI to revocation list when DB is available
    StatusCode::NO_CONTENT
}

async fn me(
    axum::Extension(auth): axum::Extension<crate::auth::middleware::AuthContext>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "userId": auth.user_id,
        "role": auth.role,
        "permissions": auth.permissions,
        "authMethod": format!("{:?}", auth.auth_method),
    }))
}

// ── API key handlers ──────────────────────────────────────────────────────

async fn list_api_keys(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::list_api_keys(pool, "default").await {
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
struct CreateApiKeyRequest {
    name: String,
    key_hash: String,
    key_prefix: String,
    #[serde(default = "default_permissions")]
    permissions: serde_json::Value,
    expires_at: Option<i64>,
}

fn default_permissions() -> serde_json::Value {
    serde_json::json!(["*:*"])
}

async fn create_api_key(
    State(state): State<AppState>,
    Json(body): Json<CreateApiKeyRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match auth::create_api_key(
        pool,
        &id,
        &body.name,
        &body.key_hash,
        &body.key_prefix,
        &body.permissions,
        body.expires_at,
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

async fn revoke_api_key(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match auth::delete_api_key(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "API key not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── User handlers ─────────────────────────────────────────────────────────

async fn list_users(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::list_users(pool, "default").await {
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
struct CreateUserRequest {
    username: String,
    #[serde(default = "default_role")]
    role: String,
}

fn default_role() -> String {
    "viewer".to_string()
}

async fn create_user(
    State(state): State<AppState>,
    Json(body): Json<CreateUserRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match auth::create_user(pool, &id, &body.username, &body.role, "default").await {
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
struct UpdateUserRoleRequest {
    role: String,
}

async fn update_user_role(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateUserRoleRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::update_user_role(pool, &id, &body.role, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "User not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Settings ──────────────────────────────────────────────────────────────

async fn get_auth_settings(State(state): State<AppState>) -> impl IntoResponse {
    let has_admin_password = std::env::var("SECUREYEOMAN_ADMIN_PASSWORD")
        .map(|p| !p.is_empty())
        .unwrap_or(false);

    let has_db = state.db().is_some();

    Json(serde_json::json!({
        "adminPasswordConfigured": has_admin_password,
        "databaseAvailable": has_db,
        "jwtEnabled": true,
        "apiKeyAuthEnabled": has_db,
    }))
    .into_response()
}
