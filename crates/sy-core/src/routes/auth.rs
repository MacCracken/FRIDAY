//! Auth routes — login, refresh, logout, token management.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::auth::jwt::{issue_access_token, issue_refresh_token, validate_token};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/refresh", post(refresh))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/me", get(me))
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
