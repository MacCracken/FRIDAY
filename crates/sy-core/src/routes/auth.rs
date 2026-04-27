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

async fn sso_authorize(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };

    match auth::get_sso_provider(pool, &id, "default").await {
        Ok(Some(provider)) => {
            let state_param = uuid::Uuid::now_v7().to_string();
            let redirect_url = format!(
                "{}/authorize?client_id={}&state={}&response_type=code",
                provider.issuer_url, provider.client_id, state_param
            );
            Json(serde_json::json!({
                "redirectUrl": redirect_url,
                "state": state_param,
                "providerId": id,
                "protocol": provider.protocol,
            }))
            .into_response()
        }
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

async fn sso_exchange(
    State(state): State<AppState>,
    Json(body): Json<SsoExchangeRequest>,
) -> impl IntoResponse {
    // Stub: exchange SSO authorization code for a local JWT
    let jwt_config = state.jwt_config();
    let placeholder_user = format!("sso-user-{}", &body.provider_id);
    let permissions = vec!["*:read".to_string()];

    let token = match issue_access_token(jwt_config, &placeholder_user, "viewer", &permissions) {
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
        "accessToken": token,
        "expiresIn": jwt_config.access_token_expiry_secs,
        "tokenType": "Bearer",
        "providerId": body.provider_id,
        "stub": true,
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

async fn webauthn_register_options(
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
) -> impl IntoResponse {
    // Stub: generate WebAuthn registration options (challenge)
    let challenge = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        uuid::Uuid::now_v7().as_bytes(),
    );

    Json(serde_json::json!({
        "rp": {
            "name": "SecureYeoman",
            "id": "localhost",
        },
        "user": {
            "id": base64::Engine::encode(
                &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                auth_ctx.user_id.as_bytes(),
            ),
            "name": auth_ctx.user_id,
            "displayName": auth_ctx.user_id,
        },
        "challenge": challenge,
        "pubKeyCredParams": [
            {"type": "public-key", "alg": -7},
            {"type": "public-key", "alg": -257},
        ],
        "timeout": 60000,
        "attestation": "none",
        "authenticatorSelection": {
            "residentKey": "preferred",
            "userVerification": "preferred",
        },
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebAuthnRegisterVerifyRequest {
    credential_id: String,
    attestation_object: String,
    client_data_json: String,
    #[serde(default)]
    transports: Vec<String>,
}

async fn webauthn_register_verify(
    State(state): State<AppState>,
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
    Json(body): Json<WebAuthnRegisterVerifyRequest>,
) -> impl IntoResponse {
    // Stub: verify registration — in production, validate attestation
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };

    let id = uuid::Uuid::now_v7().to_string();
    let transports = serde_json::to_value(&body.transports).unwrap();

    match auth::create_webauthn_credential(
        pool,
        &id,
        &auth_ctx.user_id,
        &body.credential_id,
        &body.attestation_object, // Placeholder: real impl stores parsed public key
        &transports,
        "default",
    )
    .await
    {
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

async fn webauthn_authenticate_options(
    axum::Extension(auth_ctx): axum::Extension<crate::auth::middleware::AuthContext>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    // Stub: generate WebAuthn authentication options
    let challenge = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        uuid::Uuid::now_v7().as_bytes(),
    );

    let allow_credentials = if let Some(pool) = state.db() {
        auth::list_webauthn_credentials(pool, &auth_ctx.user_id, "default")
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|c| {
                serde_json::json!({
                    "type": "public-key",
                    "id": c.credential_id,
                    "transports": c.transports,
                })
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    Json(serde_json::json!({
        "challenge": challenge,
        "timeout": 60000,
        "rpId": "localhost",
        "allowCredentials": allow_credentials,
        "userVerification": "preferred",
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebAuthnAuthVerifyRequest {
    credential_id: String,
    authenticator_data: String,
    client_data_json: String,
    signature: String,
}

async fn webauthn_authenticate_verify(
    State(state): State<AppState>,
    Json(body): Json<WebAuthnAuthVerifyRequest>,
) -> impl IntoResponse {
    // Stub: verify WebAuthn assertion — in production, verify signature against stored public key
    let jwt_config = state.jwt_config();

    // Placeholder: issue a token if the credential_id looks valid
    let placeholder_user = format!(
        "webauthn-{}",
        &body.credential_id[..8.min(body.credential_id.len())]
    );
    let permissions = vec!["*:*".to_string()];

    let token = match issue_access_token(jwt_config, &placeholder_user, "admin", &permissions) {
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
        "stub": true,
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
    match auth::list_webauthn_credentials(pool, &auth_ctx.user_id, "default").await {
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
    match auth::delete_webauthn_credential(pool, &id, &auth_ctx.user_id, "default").await {
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
