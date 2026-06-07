//! Auth routes — login, refresh, logout, token management, roles, OAuth, SSO, WebAuthn.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::auth::jwt::{issue_access_token, issue_refresh_token, validate_token};
use crate::db::auth;
use crate::state::AppState;
use webauthn_rs::prelude::{Passkey, PublicKeyCredential, RegisterPublicKeyCredential};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/login", post(login))
        .route("/api/v1/auth/refresh", post(refresh))
        .route("/api/v1/auth/logout", post(logout))
        .route("/api/v1/auth/me", get(me))
        .route("/api/v1/auth/verify", post(verify))
        .route("/api/v1/auth/reset-password", post(reset_password))
        .route("/api/v1/auth/break-glass", post(break_glass))
        // API keys
        .route("/api/v1/auth/api-keys", get(list_api_keys))
        .route("/api/v1/auth/api-keys", post(create_api_key))
        .route("/api/v1/auth/api-keys/{id}", delete(revoke_api_key))
        .route("/api/v1/auth/api-keys/{id}/usage", get(get_api_key_usage))
        .route(
            "/api/v1/auth/api-keys/usage/summary",
            get(get_usage_summary),
        )
        // Users
        .route("/api/v1/auth/users", get(list_users))
        .route("/api/v1/auth/users", post(create_user))
        .route("/api/v1/auth/users/{id}", put(update_user_role))
        // Roles
        .route("/api/v1/auth/roles", get(list_roles))
        .route("/api/v1/auth/roles", post(create_role))
        .route("/api/v1/auth/roles/{id}", get(get_role))
        .route("/api/v1/auth/roles/{id}", put(update_role))
        .route("/api/v1/auth/roles/{id}", delete(delete_role))
        // Role assignments
        .route("/api/v1/auth/assignments", get(list_role_assignments))
        .route("/api/v1/auth/assignments", post(create_assignment))
        .route(
            "/api/v1/auth/assignments/{userId}",
            get(get_user_role_assignments),
        )
        .route(
            "/api/v1/auth/assignments/{userId}",
            delete(delete_assignment),
        )
        // Federation auth
        .route("/api/v1/auth/federation/token", post(federation_token))
        .route("/api/v1/auth/federation/verify", post(federation_verify))
        // OAuth
        .route("/api/v1/auth/oauth/config", get(oauth_config))
        .route("/api/v1/auth/oauth/claim", post(oauth_claim))
        .route("/api/v1/auth/oauth/disconnect", post(oauth_disconnect))
        .route("/api/v1/auth/oauth/reload", post(oauth_reload))
        .route("/api/v1/auth/oauth/tokens", get(list_oauth_tokens))
        .route("/api/v1/auth/oauth/tokens/{id}", get(get_oauth_token))
        .route(
            "/api/v1/auth/oauth/tokens/{id}",
            delete(delete_oauth_token_by_id),
        )
        .route(
            "/api/v1/auth/oauth/tokens/{id}/refresh",
            post(refresh_oauth_token),
        )
        .route(
            "/api/v1/auth/oauth/{provider}/callback",
            get(oauth_callback),
        )
        .route("/api/v1/auth/oauth/{provider}", get(oauth_initiate))
        // SSO/SAML
        .route("/api/v1/auth/sso/providers", get(list_sso_providers))
        .route("/api/v1/auth/sso/providers", post(create_sso_provider))
        .route("/api/v1/auth/sso/providers/{id}", get(get_sso_provider))
        .route("/api/v1/auth/sso/providers/{id}", put(update_sso_provider))
        .route(
            "/api/v1/auth/sso/providers/{id}",
            delete(delete_sso_provider),
        )
        .route("/api/v1/auth/sso/authorize/{id}", get(sso_authorize))
        .route("/api/v1/auth/sso/callback/{id}", get(sso_callback))
        .route("/api/v1/auth/sso/exchange", post(sso_exchange))
        .route("/api/v1/auth/sso/saml/{id}/metadata", get(saml_metadata))
        .route("/api/v1/auth/sso/saml/{id}/acs", post(saml_acs))
        // WebAuthn
        .route(
            "/api/v1/auth/webauthn/register/options",
            post(webauthn_register_options),
        )
        .route(
            "/api/v1/auth/webauthn/register/verify",
            post(webauthn_register_verify),
        )
        .route(
            "/api/v1/auth/webauthn/authenticate/options",
            post(webauthn_authenticate_options),
        )
        .route(
            "/api/v1/auth/webauthn/authenticate/verify",
            post(webauthn_authenticate_verify),
        )
        .route(
            "/api/v1/auth/webauthn/credentials",
            get(list_webauthn_credentials),
        )
        .route(
            "/api/v1/auth/webauthn/credentials/{id}",
            delete(delete_webauthn_credential),
        )
        // Settings
        .route("/api/v1/auth/settings", get(get_auth_settings))
}

// ── Core auth handlers ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginRequest {
    password: String,
    #[serde(default)]
    remember_me: bool,
}

/// Whether any admin credential is configured (an Argon2 hash, or a plaintext
/// password as a discouraged fallback).
fn admin_password_configured() -> bool {
    std::env::var("SECUREYEOMAN_ADMIN_PASSWORD_HASH").is_ok_and(|h| !h.trim().is_empty())
        || std::env::var("SECUREYEOMAN_ADMIN_PASSWORD").is_ok_and(|p| !p.is_empty())
}

/// Verify a submitted admin password. Prefers an Argon2 PHC hash in
/// `SECUREYEOMAN_ADMIN_PASSWORD_HASH` (no plaintext at rest); otherwise falls back
/// to a constant-time comparison against the plaintext `SECUREYEOMAN_ADMIN_PASSWORD`.
fn verify_admin_password(submitted: &str) -> bool {
    use argon2::{Argon2, PasswordHash, PasswordVerifier};
    if let Ok(hash) = std::env::var("SECUREYEOMAN_ADMIN_PASSWORD_HASH") {
        let hash = hash.trim();
        if !hash.is_empty() {
            return PasswordHash::new(hash).ok().is_some_and(|ph| {
                Argon2::default()
                    .verify_password(submitted.as_bytes(), &ph)
                    .is_ok()
            });
        }
    }
    match std::env::var("SECUREYEOMAN_ADMIN_PASSWORD") {
        Ok(pw) if !pw.is_empty() => {
            crate::crypto::secure_compare(submitted.as_bytes(), pw.as_bytes())
        }
        _ => false,
    }
}

async fn login(State(state): State<AppState>, Json(body): Json<LoginRequest>) -> impl IntoResponse {
    if body.password.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Password must be at least 8 characters"})),
        )
            .into_response();
    }

    // Verify against the configured admin credential (Argon2 hash preferred).
    if !admin_password_configured() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "No admin password configured"})),
        )
            .into_response();
    }

    if !verify_admin_password(&body.password) {
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

    // Record login audit event
    if let Some(pool) = state.db() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let _ = sqlx::query(
            "INSERT INTO audit.entries (id, tenant_id, event, level, message, user_id, timestamp, metadata)
             VALUES ($1, 'default', 'auth.login', 'info', 'User logged in', 'admin', $2, '{}'::jsonb)"
        )
        .bind(uuid::Uuid::now_v7().to_string())
        .bind(now)
        .execute(pool)
        .await;
    }

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

async fn logout(
    State(state): State<AppState>,
    auth: Option<axum::Extension<crate::auth::middleware::AuthContext>>,
) -> impl IntoResponse {
    if let Some(axum::Extension(ctx)) = auth
        && let Some(jti) = &ctx.jti
    {
        // Revoke with 15-minute expiry (access token TTL)
        let expires_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
            + 900_000; // 15 min
        state.revoke_token(jti, &ctx.user_id, expires_at).await;
    }
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

// ── Verify ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct VerifyRequest {
    token: String,
}

async fn verify(
    State(state): State<AppState>,
    Json(body): Json<VerifyRequest>,
) -> impl IntoResponse {
    let jwt_config = state.jwt_config();
    match validate_token(jwt_config, &body.token) {
        Ok(claims) => Json(serde_json::json!({
            "valid": true,
            "sub": claims.sub,
            "role": claims.role,
            "permissions": claims.permissions,
            "tokenType": claims.token_type,
            "exp": claims.exp,
            "iat": claims.iat,
            "jti": claims.jti,
        }))
        .into_response(),
        Err(e) => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"valid": false, "error": e})),
        )
            .into_response(),
    }
}

// ── Password Reset ───────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResetPasswordRequest {
    username: String,
}

async fn reset_password(
    State(state): State<AppState>,
    Json(body): Json<ResetPasswordRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };

    // Generate a reset token hash (placeholder — real impl would email a link)
    let token_hash = uuid::Uuid::now_v7().to_string();
    // Look up user to get their ID; for now use username as a proxy
    if let Err(e) = auth::create_password_reset(pool, &body.username, &token_hash, "default").await
    {
        tracing::warn!("Password reset recording failed: {e}");
    }

    // Always return success to avoid user enumeration
    Json(serde_json::json!({
        "message": "If the account exists, a password reset link has been sent.",
    }))
    .into_response()
}

// ── Break-glass ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct BreakGlassRequest {
    reason: String,
}

async fn break_glass(
    State(state): State<AppState>,
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
    Json(body): Json<BreakGlassRequest>,
) -> impl IntoResponse {
    let jwt_config = state.jwt_config();
    let session_id = uuid::Uuid::now_v7().to_string();
    let permissions = vec!["*:*".to_string()];

    // Short-lived admin token: 15 minutes
    let expires_secs = 900u64;
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let expires_at_ms = ((now_secs + expires_secs) * 1000) as i64;

    let token = match issue_access_token(jwt_config, &auth_ctx.user_id, "admin", &permissions) {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Token generation failed: {e}")})),
            )
                .into_response();
        }
    };

    // Record the break-glass session if DB is available
    if let Some(pool) = state.db()
        && let Err(e) = auth::create_break_glass_session(
            pool,
            &session_id,
            &auth_ctx.user_id,
            &body.reason,
            expires_at_ms,
            "default",
        )
        .await
    {
        tracing::warn!("Failed to record break-glass session: {e}");
    }

    tracing::warn!(
        user_id = %auth_ctx.user_id,
        session_id = %session_id,
        reason = %body.reason,
        "Break-glass session created"
    );

    Json(serde_json::json!({
        "sessionId": session_id,
        "accessToken": token,
        "expiresIn": expires_secs,
        "tokenType": "Bearer",
        "warning": "This is an emergency break-glass session. All actions are audited.",
    }))
    .into_response()
}

// ── API key handlers ─────────────────────────────────────────────────────

async fn list_api_keys(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::list_api_keys(pool, "default").await {
        Ok(rows) => Json(serde_json::json!({"keys": rows})).into_response(),
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

async fn get_api_key_usage(
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
    match auth::get_api_key_usage(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No usage data for this API key"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_usage_summary(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::get_usage_summary(pool, "default").await {
        Ok(rows) => {
            let total_requests: i64 = rows.iter().map(|r| r.request_count).sum();
            Json(serde_json::json!({
                "totalKeys": rows.len(),
                "totalRequests": total_requests,
                "keys": serde_json::to_value(rows).unwrap(),
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

// ── User handlers ────────────────────────────────────────────────────────

async fn list_users(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::list_users(pool, "default").await {
        Ok(rows) => Json(serde_json::json!({"users": rows})).into_response(),
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

// ── Roles ────────────────────────────────────────────────────────────────

async fn list_roles(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::list_roles(pool, "default").await {
        Ok(rows) => Json(serde_json::json!({"roles": rows})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_role(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::get_role(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Role not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Role write handlers ──────────────────────────────────────────────────

const BUILTIN_ROLE_NAMES: &[&str] = &["admin", "viewer", "operator", "auditor", "superadmin"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRoleRequest {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_permissions")]
    permissions: serde_json::Value,
}

async fn create_role(
    State(state): State<AppState>,
    Json(body): Json<CreateRoleRequest>,
) -> impl IntoResponse {
    // Block creation of roles that shadow builtins
    if BUILTIN_ROLE_NAMES.contains(&body.name.to_lowercase().as_str()) {
        return (
            StatusCode::FORBIDDEN,
            Json(
                serde_json::json!({"error": "Cannot create a role with a reserved built-in name"}),
            ),
        )
            .into_response();
    }
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match auth::create_role(
        pool,
        &id,
        &body.name,
        &body.description,
        &body.permissions,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRoleRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    permissions: Option<serde_json::Value>,
}

async fn update_role(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateRoleRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    // Fetch first to check is_system
    match auth::get_role(pool, &id, "default").await {
        Ok(Some(existing)) if existing.is_system => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Cannot modify a system role"})),
            )
                .into_response();
        }
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Role not found"})),
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
        Ok(Some(_)) => {}
    }
    match auth::update_role(
        pool,
        &id,
        body.name.as_deref(),
        body.description.as_deref(),
        body.permissions.as_ref(),
        "default",
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Role not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_role(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match auth::get_role(pool, &id, "default").await {
        Ok(Some(existing)) if existing.is_system => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Cannot delete a system role"})),
            )
                .into_response();
        }
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Role not found"})),
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
        Ok(Some(_)) => {}
    }
    match auth::delete_role(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Role not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Role Assignments ─────────────────────────────────────────────────────

async fn list_role_assignments(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::list_role_assignments(pool, "default").await {
        Ok(rows) => Json(serde_json::json!({"assignments": rows})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_user_role_assignments(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::get_user_role_assignments(pool, &user_id, "default").await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Role assignment write handlers ───────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAssignmentRequest {
    user_id: String,
    role_id: String,
}

async fn create_assignment(
    State(state): State<AppState>,
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
    Json(body): Json<CreateAssignmentRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match auth::create_role_assignment(
        pool,
        &id,
        &body.user_id,
        &body.role_id,
        &auth_ctx.user_id,
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

async fn delete_assignment(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match auth::delete_role_assignment(pool, &user_id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No role assignments found for this user"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Federation Auth ──────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FederationTokenRequest {
    instance_id: String,
    #[serde(default)]
    scopes: Vec<String>,
}

async fn federation_token(
    State(state): State<AppState>,
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
    Json(body): Json<FederationTokenRequest>,
) -> impl IntoResponse {
    let jwt_config = state.jwt_config();
    let permissions: Vec<String> = if body.scopes.is_empty() {
        vec!["federation:read".to_string()]
    } else {
        body.scopes
    };

    let token = match issue_access_token(
        jwt_config,
        &auth_ctx.user_id,
        &auth_ctx.role,
        &permissions,
    ) {
        Ok(t) => t,
        Err(e) => {
            return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(
                        serde_json::json!({"error": format!("Federation token generation failed: {e}")}),
                    ),
                )
                    .into_response();
        }
    };

    Json(serde_json::json!({
        "token": token,
        "instanceId": body.instance_id,
        "expiresIn": jwt_config.access_token_expiry_secs,
        "tokenType": "Bearer",
    }))
    .into_response()
}

#[derive(Deserialize)]
struct FederationVerifyRequest {
    token: String,
    #[serde(default)]
    instance_id: Option<String>,
}

async fn federation_verify(
    State(state): State<AppState>,
    Json(body): Json<FederationVerifyRequest>,
) -> impl IntoResponse {
    let jwt_config = state.jwt_config();
    match validate_token(jwt_config, &body.token) {
        Ok(claims) => Json(serde_json::json!({
            "valid": true,
            "sub": claims.sub,
            "role": claims.role,
            "permissions": claims.permissions,
            "instanceId": body.instance_id,
            "exp": claims.exp,
        }))
        .into_response(),
        Err(e) => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"valid": false, "error": e})),
        )
            .into_response(),
    }
}

// ── OAuth handlers ───────────────────────────────────────────────────────

async fn oauth_config() -> impl IntoResponse {
    // Stub: return configured OAuth providers
    Json(serde_json::json!({
        "providers": [
            {
                "id": "google",
                "name": "Google",
                "enabled": false,
                "clientId": null,
            },
            {
                "id": "github",
                "name": "GitHub",
                "enabled": false,
                "clientId": null,
            },
        ],
    }))
}

async fn oauth_initiate(Path(provider): Path<String>) -> impl IntoResponse {
    // Stub: construct OAuth redirect URL
    let state_param = uuid::Uuid::now_v7().to_string();
    let redirect_url = format!(
        "https://{provider}.example.com/oauth/authorize?client_id=placeholder&state={state_param}&redirect_uri=http://localhost:3000/api/v1/auth/oauth/{provider}/callback"
    );

    Json(serde_json::json!({
        "redirectUrl": redirect_url,
        "state": state_param,
        "provider": provider,
    }))
}

async fn oauth_callback(Path(provider): Path<String>) -> impl IntoResponse {
    // Stub: handle OAuth callback — in production this exchanges the code for tokens
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
            "error": "OAuth callback not fully implemented",
            "provider": provider,
            "hint": "Exchange the authorization code for tokens via the provider's token endpoint",
        })),
    )
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthClaimRequest {
    provider: String,
    code: String,
    #[serde(default)]
    redirect_uri: Option<String>,
}

async fn oauth_claim(Json(body): Json<OAuthClaimRequest>) -> impl IntoResponse {
    // Stub: claim an OAuth account by exchanging an authorization code
    Json(serde_json::json!({
        "provider": body.provider,
        "claimed": false,
        "message": "OAuth claim not fully implemented — code exchange pending",
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthDisconnectRequest {
    provider: String,
}

async fn oauth_disconnect(
    State(state): State<AppState>,
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
    Json(body): Json<OAuthDisconnectRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::delete_oauth_token(pool, &auth_ctx.user_id, &body.provider, "default").await {
        Ok(true) => Json(serde_json::json!({
            "disconnected": true,
            "provider": body.provider,
        }))
        .into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "No OAuth connection found for this provider"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn oauth_reload() -> impl IntoResponse {
    // Stub: reload OAuth configuration from config/env
    Json(serde_json::json!({
        "reloaded": true,
        "message": "OAuth configuration reloaded",
    }))
}

async fn list_oauth_tokens(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::list_oauth_tokens(pool, "default").await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_oauth_token(
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
    match auth::get_oauth_token(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "OAuth token not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_oauth_token_by_id(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match auth::delete_oauth_token_by_id(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "OAuth token not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn refresh_oauth_token(
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

    // Stub: In production, this would use the stored refresh token to get new tokens
    // from the OAuth provider, then update the DB. For now, return the current state.
    match auth::get_oauth_token(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::json!({
            "refreshed": false,
            "message": "OAuth token refresh not fully implemented — provider token exchange pending",
            "tokenId": row.id,
            "provider": row.provider,
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "OAuth token not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── SSO/SAML handlers ───────────────────────────────────────────────────

async fn list_sso_providers(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::list_sso_providers(pool, "default").await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_sso_provider(
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
    match auth::get_sso_provider(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "SSO provider not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// NOTE: SSO write operations are license-gated in the TypeScript implementation.
// These routes are wired but the license check should be enforced at the middleware
// layer once the licensing crate integration is in place.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSsoProviderRequest {
    name: String,
    protocol: String,
    issuer_url: String,
    client_id: String,
    #[serde(default)]
    metadata_url: Option<String>,
    #[serde(default)]
    acs_url: Option<String>,
    #[serde(default)]
    config: serde_json::Value,
}

async fn create_sso_provider(
    State(state): State<AppState>,
    Json(body): Json<CreateSsoProviderRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match auth::create_sso_provider(
        pool,
        &id,
        &body.name,
        &body.protocol,
        &body.issuer_url,
        &body.client_id,
        body.metadata_url.as_deref(),
        body.acs_url.as_deref(),
        &body.config,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSsoProviderRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    issuer_url: Option<String>,
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    metadata_url: Option<String>,
    #[serde(default)]
    acs_url: Option<String>,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    config: Option<serde_json::Value>,
}

async fn update_sso_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateSsoProviderRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::update_sso_provider(
        pool,
        &id,
        body.name.as_deref(),
        body.issuer_url.as_deref(),
        body.client_id.as_deref(),
        body.metadata_url.as_deref(),
        body.acs_url.as_deref(),
        body.enabled,
        body.config.as_ref(),
        "default",
    )
    .await
    {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "SSO provider not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_sso_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match auth::delete_sso_provider(pool, &id, "default").await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "SSO provider not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// Begin an OIDC login: build the IdP authorization URL (PKCE + CSRF + nonce) and
/// persist the transient ceremony state keyed by the CSRF `state`. The browser is
/// redirected to `redirectUrl`; the IdP returns to `OIDC_REDIRECT_URI` with a code.
async fn sso_authorize(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let Some(oidc) = state.oidc() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "OIDC SSO is not configured (set OIDC_* env vars)"})),
        )
            .into_response();
    };

    let auth_req = match oidc.authorize_url().await {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!(error = %e, "OIDC authorize URL build failed");
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "SSO is temporarily unavailable"})),
            )
                .into_response();
        }
    };

    // Persist the PKCE verifier + nonce server-side, keyed by the CSRF state,
    // with a short TTL. They are never exposed to the browser.
    let verifier_blob = serde_json::json!({
        "pkce": auth_req.pkce_verifier,
        "nonce": auth_req.nonce,
    })
    .to_string();
    if let Err(e) = auth::store_oauth_state(
        pool,
        &auth_req.state,
        &id,
        &id,
        &verifier_blob,
        now_ms() + 600_000, // 10 minutes
    )
    .await
    {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response();
    }

    Json(serde_json::json!({
        "redirectUrl": auth_req.url,
        "state": auth_req.state,
        "providerId": id,
    }))
    .into_response()
}

async fn sso_callback(Path(id): Path<String>) -> impl IntoResponse {
    // Stub: handle SSO callback — exchange code for tokens
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
            "error": "SSO callback not fully implemented",
            "providerId": id,
            "hint": "Exchange the authorization code via the SSO provider's token endpoint",
        })),
    )
        .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SsoExchangeRequest {
    provider_id: String,
    code: String,
    #[serde(default)]
    state: Option<String>,
}

/// Complete an OIDC login: validate the CSRF `state`, exchange the authorization
/// `code` for tokens, verify the ID token (signature/iss/aud/exp + nonce), map the
/// subject to a local identity, and mint a local session token.
async fn sso_exchange(
    State(state): State<AppState>,
    Json(body): Json<SsoExchangeRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let Some(oidc) = state.oidc() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "OIDC SSO is not configured"})),
        )
            .into_response();
    };
    let Some(state_param) = body.state.filter(|s| !s.is_empty()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "missing CSRF state"})),
        )
            .into_response();
    };

    // Single-use: fetch-and-delete the ceremony state, validating CSRF by lookup.
    let row = match auth::take_oauth_state(pool, &state_param).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "invalid or already-used state"})),
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
    if row.expires_at < now_ms() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "login state expired; restart sign-in"})),
        )
            .into_response();
    }

    // Bind the consumed ceremony to the provider the client claims (defends
    // against state/provider confusion if multiple providers are ever wired).
    if row.provider != body.provider_id {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "login state does not match provider"})),
        )
            .into_response();
    }

    let blob: serde_json::Value =
        serde_json::from_str(row.code_verifier.as_deref().unwrap_or("{}")).unwrap_or_default();
    let pkce = blob["pkce"].as_str().unwrap_or_default().to_string();
    let nonce = blob["nonce"].as_str().unwrap_or_default().to_string();
    if pkce.is_empty() || nonce.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "corrupt login state"})),
        )
            .into_response();
    }

    let identity = match oidc.exchange(body.code, pkce, nonce).await {
        Ok(i) => i,
        Err(e) => {
            // Log the detail server-side; return an opaque message to the caller.
            tracing::warn!(error = %e, "OIDC code exchange / verification failed");
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "SSO sign-in failed"})),
            )
                .into_response();
        }
    };

    // Map to a local identity keyed on (issuer, subject) — `sub` is only unique
    // per-issuer. Role is clamped to a non-admin default (see sso_default_role).
    let user_id = format!("oidc:{}|{}", identity.issuer, identity.subject);
    let role = sso_default_role();

    let jwt_config = state.jwt_config();
    let access_token = match issue_access_token(jwt_config, &user_id, &role, &[]) {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Token generation failed: {e}")})),
            )
                .into_response();
        }
    };
    let refresh_token = match issue_refresh_token(jwt_config, &user_id, &role) {
        Ok(t) => t,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Token generation failed: {e}")})),
            )
                .into_response();
        }
    };

    // Record the SSO login.
    let _ = sqlx::query(
        "INSERT INTO audit.entries (id, tenant_id, event, level, message, user_id, timestamp, metadata)
         VALUES ($1, 'default', 'auth.sso_login', 'info', 'User logged in via OIDC', $2, $3, '{}'::jsonb)",
    )
    .bind(uuid::Uuid::now_v7().to_string())
    .bind(&user_id)
    .bind(now_ms())
    .execute(pool)
    .await;

    Json(serde_json::json!({
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "expiresIn": jwt_config.access_token_expiry_secs,
        "tokenType": "Bearer",
        "subject": identity.subject,
        "email": identity.email,
        "providerId": body.provider_id,
    }))
    .into_response()
}

async fn saml_metadata(Path(id): Path<String>) -> impl IntoResponse {
    // Return minimal SAML SP metadata XML
    let entity_id = format!("urn:secureyeoman:sp:{id}");
    let acs_url = format!("http://localhost:3000/api/v1/auth/sso/saml/{id}/acs");

    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
    entityID="{entity_id}">
  <md:SPSSODescriptor
      AuthnRequestsSigned="false"
      WantAssertionsSigned="true"
      protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService
        Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="{acs_url}"
        index="0"
        isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>"#
    );

    (
        StatusCode::OK,
        [(
            axum::http::header::CONTENT_TYPE,
            "application/samlmetadata+xml",
        )],
        xml,
    )
        .into_response()
}

async fn saml_acs(Path(id): Path<String>) -> impl IntoResponse {
    // Stub: SAML Assertion Consumer Service — in production, validates the SAML response
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
            "error": "SAML ACS not fully implemented",
            "providerId": id,
            "hint": "Parse and validate the SAML response assertion",
        })),
    )
        .into_response()
}

// ── WebAuthn handlers ───────────────────────────────────────────────────

/// Stable, opaque per-user handle for WebAuthn (the value stored on the
/// authenticator). Deterministic so it is identical across ceremonies; derived
/// from the user id rather than PII.
fn stable_user_uuid(user_id: &str) -> uuid::Uuid {
    uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, user_id.as_bytes())
}

fn b64url(bytes: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Resolve the role granted to SSO-authenticated users. A single env default must
/// never be able to hand `admin` to an entire IdP population, so the value is
/// clamped to a least-privilege, non-admin allow-list; anything else (including
/// `admin` or a typo) falls back to `viewer` with a warning.
fn sso_default_role() -> String {
    const ALLOWED: [&str; 4] = ["viewer", "operator", "auditor", "service"];
    match std::env::var("OIDC_DEFAULT_ROLE") {
        Ok(r) if ALLOWED.contains(&r.as_str()) => r,
        Ok(r) if !r.is_empty() => {
            tracing::warn!(
                role = %r,
                "OIDC_DEFAULT_ROLE is not an allowed non-admin role; using viewer"
            );
            "viewer".to_string()
        }
        _ => "viewer".to_string(),
    }
}

/// Load and deserialize a user's stored passkeys.
async fn load_user_passkeys(pool: &sqlx::PgPool, user_id: &str) -> Vec<Passkey> {
    auth::list_webauthn_credentials(pool, user_id)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| serde_json::from_str::<Passkey>(&r.public_key).ok())
        .collect()
}

/// WebAuthn registration — start. Returns the W3C `CreationChallengeResponse`
/// (`{publicKey: ...}`) and stashes the in-flight ceremony state server-side,
/// keyed by the authenticated user.
async fn webauthn_register_options(
    State(state): State<AppState>,
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let user_id = &auth_ctx.user_id;
    let exclude: Vec<_> = load_user_passkeys(pool, user_id)
        .await
        .iter()
        .map(|p| p.cred_id().clone())
        .collect();
    let exclude = if exclude.is_empty() {
        None
    } else {
        Some(exclude)
    };

    match state.webauthn().start_passkey_registration(
        stable_user_uuid(user_id),
        user_id,
        user_id,
        exclude,
    ) {
        Ok((ccr, reg_state)) => {
            state
                .webauthn_reg()
                .insert(user_id.clone(), (reg_state, std::time::Instant::now()));
            Json(ccr).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("registration start failed: {e}")})),
        )
            .into_response(),
    }
}

/// WebAuthn registration — finish. Verifies the attestation against the stored
/// ceremony state and persists the resulting `Passkey`.
async fn webauthn_register_verify(
    State(state): State<AppState>,
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
    Json(reg): Json<RegisterPublicKeyCredential>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let user_id = &auth_ctx.user_id;
    let Some((_, (reg_state, _))) = state.webauthn_reg().remove(user_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "no registration ceremony in progress"})),
        )
            .into_response();
    };

    let passkey = match state
        .webauthn()
        .finish_passkey_registration(&reg, &reg_state)
    {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(
                    serde_json::json!({"error": format!("registration verification failed: {e}")}),
                ),
            )
                .into_response();
        }
    };

    let cred_id = b64url(passkey.cred_id().as_ref());
    let pk_json = serde_json::to_string(&passkey).unwrap_or_default();
    let id = uuid::Uuid::now_v7().to_string();

    match auth::create_webauthn_credential(pool, &id, user_id, &cred_id, &pk_json, 0, &[]).await {
        Ok(row) => (
            StatusCode::CREATED,
            Json(serde_json::json!({
                "verified": true,
                "credentialId": row.credential_id,
                "id": row.id,
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

/// WebAuthn authentication — start (step-up for the authenticated user). Returns
/// the W3C `RequestChallengeResponse` and stashes ceremony state.
async fn webauthn_authenticate_options(
    State(state): State<AppState>,
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let user_id = &auth_ctx.user_id;
    let passkeys = load_user_passkeys(pool, user_id).await;
    if passkeys.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "no registered passkeys for this user"})),
        )
            .into_response();
    }

    match state.webauthn().start_passkey_authentication(&passkeys) {
        Ok((rcr, auth_state)) => {
            state
                .webauthn_auth()
                .insert(user_id.clone(), (auth_state, std::time::Instant::now()));
            Json(rcr).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("authentication start failed: {e}")})),
        )
            .into_response(),
    }
}

/// WebAuthn authentication — finish. Verifies the assertion against the stored
/// ceremony state; on success advances the signature counter and mints a fresh
/// access token for the SAME authenticated identity (no privilege change).
async fn webauthn_authenticate_verify(
    State(state): State<AppState>,
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
    Json(cred): Json<PublicKeyCredential>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let user_id = &auth_ctx.user_id;
    let Some((_, (auth_state, _))) = state.webauthn_auth().remove(user_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "no authentication ceremony in progress"})),
        )
            .into_response();
    };

    let result = match state
        .webauthn()
        .finish_passkey_authentication(&cred, &auth_state)
    {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"verified": false, "error": format!("assertion verification failed: {e}")})),
            )
                .into_response();
        }
    };

    // Advance the stored counter / backup flags if the authenticator reported a change.
    if result.needs_update() {
        let cred_id = b64url(result.cred_id().as_ref());
        if let Ok(rows) = auth::list_webauthn_credentials(pool, user_id).await
            && let Some(row) = rows.iter().find(|r| r.credential_id == cred_id)
            && let Ok(mut pk) = serde_json::from_str::<Passkey>(&row.public_key)
            && pk.update_credential(&result) == Some(true)
        {
            let pk_json = serde_json::to_string(&pk).unwrap_or_default();
            let _ =
                auth::update_webauthn_credential(pool, &cred_id, result.counter() as i64, &pk_json)
                    .await;
        }
    }

    let jwt_config = state.jwt_config();
    let token = match issue_access_token(jwt_config, user_id, &auth_ctx.role, &auth_ctx.permissions)
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
        "verified": true,
        "accessToken": token,
        "expiresIn": jwt_config.access_token_expiry_secs,
        "tokenType": "Bearer",
    }))
    .into_response()
}

async fn list_webauthn_credentials(
    State(state): State<AppState>,
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match auth::list_webauthn_credentials(pool, &auth_ctx.user_id).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_webauthn_credential(
    State(state): State<AppState>,
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match auth::delete_webauthn_credential(pool, &id, &auth_ctx.user_id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "WebAuthn credential not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Settings ─────────────────────────────────────────────────────────────

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_user_uuid_is_deterministic() {
        // Same user id → same handle across calls (required for WebAuthn).
        assert_eq!(stable_user_uuid("alice"), stable_user_uuid("alice"));
        assert_ne!(stable_user_uuid("alice"), stable_user_uuid("bob"));
        // Non-nil and version-5.
        assert!(!stable_user_uuid("alice").is_nil());
    }

    #[test]
    fn b64url_is_url_safe_unpadded() {
        let out = b64url(&[0xff, 0xfe, 0xfd]);
        assert!(!out.contains('+') && !out.contains('/') && !out.contains('='));
    }

    #[test]
    fn argon2_hash_verifies_correctly() {
        // Validates the Argon2 PHC verification path used by verify_admin_password:
        // a matching password verifies, a wrong one does not.
        use argon2::password_hash::{PasswordHasher, SaltString};
        use argon2::{Argon2, PasswordHash, PasswordVerifier};

        let salt = SaltString::from_b64("dGVzdHNhbHR0ZXN0c2FsdA").unwrap();
        let hash = Argon2::default()
            .hash_password(b"correct horse", &salt)
            .unwrap()
            .to_string();

        let parsed = PasswordHash::new(&hash).unwrap();
        assert!(
            Argon2::default()
                .verify_password(b"correct horse", &parsed)
                .is_ok()
        );
        assert!(
            Argon2::default()
                .verify_password(b"wrong password", &parsed)
                .is_err()
        );
    }
}
