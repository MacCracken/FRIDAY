//! Auth storage — API keys, users, roles, assignments, OAuth, SSO, WebAuthn CRUD via PostgreSQL.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;

/// API key row from auth.api_keys table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyRow {
    pub id: String,
    pub name: String,
    pub key_hash: String,
    pub key_prefix: String,
    pub permissions: serde_json::Value,
    pub expires_at: Option<i64>,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub tenant_id: String,
}

/// User row from auth.users table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UserRow {
    pub id: String,
    pub username: String,
    pub role: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub tenant_id: String,
}

/// API key usage statistics row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyUsageRow {
    pub api_key_id: String,
    pub request_count: i64,
    pub last_used_at: Option<i64>,
    pub last_endpoint: Option<String>,
    pub last_status_code: Option<i32>,
    pub created_at: i64,
}

/// Role row from auth.roles table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RoleRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub permissions: serde_json::Value,
    pub is_system: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub tenant_id: String,
}

/// Role assignment row from auth.role_assignments table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RoleAssignmentRow {
    pub id: String,
    pub user_id: String,
    pub role_id: String,
    pub assigned_by: String,
    pub created_at: i64,
    pub tenant_id: String,
}

/// OAuth token row from auth.oauth_tokens table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenRow {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    pub provider_user_id: String,
    pub access_token_hash: String,
    pub refresh_token_hash: Option<String>,
    pub scopes: serde_json::Value,
    pub expires_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub tenant_id: String,
}

/// SSO provider row from auth.sso_providers table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SsoProviderRow {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub issuer_url: String,
    pub client_id: String,
    pub metadata_url: Option<String>,
    pub acs_url: Option<String>,
    pub enabled: bool,
    pub config: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
    pub tenant_id: String,
}

/// WebAuthn credential row from auth.webauthn_credentials table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WebAuthnCredentialRow {
    pub id: String,
    pub user_id: String,
    pub credential_id: String,
    pub public_key: String,
    pub sign_count: i64,
    pub transports: serde_json::Value,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub tenant_id: String,
}

// ── API Keys ─────────────────────────────────────────────────────────────

/// List all API keys.
pub async fn list_api_keys(pool: &PgPool, tenant_id: &str) -> Result<Vec<ApiKeyRow>, sqlx::Error> {
    sqlx::query_as::<_, ApiKeyRow>(
        "SELECT * FROM auth.api_keys WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

/// Create an API key.
#[allow(clippy::too_many_arguments)]
pub async fn create_api_key(
    pool: &PgPool,
    id: &str,
    name: &str,
    key_hash: &str,
    key_prefix: &str,
    permissions: &serde_json::Value,
    expires_at: Option<i64>,
    tenant_id: &str,
) -> Result<ApiKeyRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ApiKeyRow>(
        "INSERT INTO auth.api_keys (id, name, key_hash, key_prefix, permissions, expires_at, created_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(key_hash)
    .bind(key_prefix)
    .bind(permissions)
    .bind(expires_at)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Delete (revoke) an API key by ID.
pub async fn delete_api_key(pool: &PgPool, id: &str, tenant_id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM auth.api_keys WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Get usage stats for a specific API key.
pub async fn get_api_key_usage(
    pool: &PgPool,
    api_key_id: &str,
    tenant_id: &str,
) -> Result<Option<ApiKeyUsageRow>, sqlx::Error> {
    sqlx::query_as::<_, ApiKeyUsageRow>(
        "SELECT * FROM auth.api_key_usage WHERE api_key_id = $1
         AND api_key_id IN (SELECT id FROM auth.api_keys WHERE tenant_id = $2)",
    )
    .bind(api_key_id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Get aggregate usage summary across all API keys for a tenant.
pub async fn get_usage_summary(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Vec<ApiKeyUsageRow>, sqlx::Error> {
    sqlx::query_as::<_, ApiKeyUsageRow>(
        "SELECT u.* FROM auth.api_key_usage u
         JOIN auth.api_keys k ON k.id = u.api_key_id
         WHERE k.tenant_id = $1
         ORDER BY u.request_count DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

// ── Users ────────────────────────────────────────────────────────────────

/// List all users.
pub async fn list_users(pool: &PgPool, tenant_id: &str) -> Result<Vec<UserRow>, sqlx::Error> {
    sqlx::query_as::<_, UserRow>(
        "SELECT * FROM auth.users WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

/// Create a user.
pub async fn create_user(
    pool: &PgPool,
    id: &str,
    username: &str,
    role: &str,
    tenant_id: &str,
) -> Result<UserRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, UserRow>(
        "INSERT INTO auth.users (id, username, role, enabled, created_at, updated_at, tenant_id)
         VALUES ($1, $2, $3, true, $4, $4, $5)
         RETURNING *",
    )
    .bind(id)
    .bind(username)
    .bind(role)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Update a user's role.
pub async fn update_user_role(
    pool: &PgPool,
    id: &str,
    role: &str,
    tenant_id: &str,
) -> Result<Option<UserRow>, sqlx::Error> {
    sqlx::query_as::<_, UserRow>(
        "UPDATE auth.users SET role = $1, updated_at = $2 WHERE id = $3 AND tenant_id = $4 RETURNING *",
    )
    .bind(role)
    .bind(now_ms())
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

// ── Roles ────────────────────────────────────────────────────────────────

/// List all roles.
pub async fn list_roles(pool: &PgPool, tenant_id: &str) -> Result<Vec<RoleRow>, sqlx::Error> {
    sqlx::query_as::<_, RoleRow>("SELECT * FROM auth.roles WHERE tenant_id = $1 ORDER BY name ASC")
        .bind(tenant_id)
        .fetch_all(pool)
        .await
}

/// Get a role by ID.
pub async fn get_role(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<Option<RoleRow>, sqlx::Error> {
    sqlx::query_as::<_, RoleRow>("SELECT * FROM auth.roles WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .fetch_optional(pool)
        .await
}

/// Create a new role.
pub async fn create_role(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: &str,
    permissions: &serde_json::Value,
    tenant_id: &str,
) -> Result<RoleRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, RoleRow>(
        "INSERT INTO auth.roles (id, name, description, permissions, is_system, created_at, updated_at, tenant_id)
         VALUES ($1, $2, $3, $4, false, $5, $5, $6)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(permissions)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Update a role's mutable fields (name, description, permissions).
pub async fn update_role(
    pool: &PgPool,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    permissions: Option<&serde_json::Value>,
    tenant_id: &str,
) -> Result<Option<RoleRow>, sqlx::Error> {
    sqlx::query_as::<_, RoleRow>(
        "UPDATE auth.roles
         SET name        = COALESCE($1, name),
             description = COALESCE($2, description),
             permissions = COALESCE($3, permissions),
             updated_at  = $4
         WHERE id = $5 AND tenant_id = $6
         RETURNING *",
    )
    .bind(name)
    .bind(description)
    .bind(permissions)
    .bind(now_ms())
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Delete a role by ID.
pub async fn delete_role(pool: &PgPool, id: &str, tenant_id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM auth.roles WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Role Assignments ─────────────────────────────────────────────────────

/// List all role assignments.
pub async fn list_role_assignments(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Vec<RoleAssignmentRow>, sqlx::Error> {
    sqlx::query_as::<_, RoleAssignmentRow>(
        "SELECT * FROM auth.role_assignments WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

/// Get role assignments for a specific user.
pub async fn get_user_role_assignments(
    pool: &PgPool,
    user_id: &str,
    tenant_id: &str,
) -> Result<Vec<RoleAssignmentRow>, sqlx::Error> {
    sqlx::query_as::<_, RoleAssignmentRow>(
        "SELECT * FROM auth.role_assignments WHERE user_id = $1 AND tenant_id = $2 ORDER BY created_at DESC",
    )
    .bind(user_id)
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

/// Create a role assignment.
pub async fn create_role_assignment(
    pool: &PgPool,
    id: &str,
    user_id: &str,
    role_id: &str,
    assigned_by: &str,
    tenant_id: &str,
) -> Result<RoleAssignmentRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, RoleAssignmentRow>(
        "INSERT INTO auth.role_assignments (id, user_id, role_id, assigned_by, created_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *",
    )
    .bind(id)
    .bind(user_id)
    .bind(role_id)
    .bind(assigned_by)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Delete all role assignments for a user.
pub async fn delete_role_assignment(
    pool: &PgPool,
    user_id: &str,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    let result =
        sqlx::query("DELETE FROM auth.role_assignments WHERE user_id = $1 AND tenant_id = $2")
            .bind(user_id)
            .bind(tenant_id)
            .execute(pool)
            .await?;
    Ok(result.rows_affected() > 0)
}

// ── OAuth Tokens ─────────────────────────────────────────────────────────

/// List all OAuth tokens for a tenant.
pub async fn list_oauth_tokens(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Vec<OAuthTokenRow>, sqlx::Error> {
    sqlx::query_as::<_, OAuthTokenRow>(
        "SELECT * FROM auth.oauth_tokens WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

/// Get an OAuth token by ID.
pub async fn get_oauth_token(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<Option<OAuthTokenRow>, sqlx::Error> {
    sqlx::query_as::<_, OAuthTokenRow>(
        "SELECT * FROM auth.oauth_tokens WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Create an OAuth token.
#[allow(clippy::too_many_arguments)]
pub async fn create_oauth_token(
    pool: &PgPool,
    id: &str,
    user_id: &str,
    provider: &str,
    provider_user_id: &str,
    access_token_hash: &str,
    refresh_token_hash: Option<&str>,
    scopes: &serde_json::Value,
    expires_at: Option<i64>,
    tenant_id: &str,
) -> Result<OAuthTokenRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, OAuthTokenRow>(
        "INSERT INTO auth.oauth_tokens (id, user_id, provider, provider_user_id, access_token_hash, refresh_token_hash, scopes, expires_at, created_at, updated_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
         RETURNING *",
    )
    .bind(id)
    .bind(user_id)
    .bind(provider)
    .bind(provider_user_id)
    .bind(access_token_hash)
    .bind(refresh_token_hash)
    .bind(scopes)
    .bind(expires_at)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Delete an OAuth token (disconnect provider).
pub async fn delete_oauth_token(
    pool: &PgPool,
    user_id: &str,
    provider: &str,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM auth.oauth_tokens WHERE user_id = $1 AND provider = $2 AND tenant_id = $3",
    )
    .bind(user_id)
    .bind(provider)
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Delete an OAuth token by its primary ID.
pub async fn delete_oauth_token_by_id(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM auth.oauth_tokens WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Update OAuth token timestamps (for refresh).
pub async fn update_oauth_token(
    pool: &PgPool,
    id: &str,
    access_token_hash: &str,
    refresh_token_hash: Option<&str>,
    expires_at: Option<i64>,
    tenant_id: &str,
) -> Result<Option<OAuthTokenRow>, sqlx::Error> {
    sqlx::query_as::<_, OAuthTokenRow>(
        "UPDATE auth.oauth_tokens SET access_token_hash = $1, refresh_token_hash = $2, expires_at = $3, updated_at = $4
         WHERE id = $5 AND tenant_id = $6
         RETURNING *",
    )
    .bind(access_token_hash)
    .bind(refresh_token_hash)
    .bind(expires_at)
    .bind(now_ms())
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

// ── SSO Providers ────────────────────────────────────────────────────────

/// List all SSO providers.
pub async fn list_sso_providers(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Vec<SsoProviderRow>, sqlx::Error> {
    sqlx::query_as::<_, SsoProviderRow>(
        "SELECT * FROM auth.sso_providers WHERE tenant_id = $1 ORDER BY name ASC",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

/// Get an SSO provider by ID.
pub async fn get_sso_provider(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<Option<SsoProviderRow>, sqlx::Error> {
    sqlx::query_as::<_, SsoProviderRow>(
        "SELECT * FROM auth.sso_providers WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Create an SSO provider.
#[allow(clippy::too_many_arguments)]
pub async fn create_sso_provider(
    pool: &PgPool,
    id: &str,
    name: &str,
    protocol: &str,
    issuer_url: &str,
    client_id: &str,
    metadata_url: Option<&str>,
    acs_url: Option<&str>,
    config: &serde_json::Value,
    tenant_id: &str,
) -> Result<SsoProviderRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, SsoProviderRow>(
        "INSERT INTO auth.sso_providers (id, name, protocol, issuer_url, client_id, metadata_url, acs_url, enabled, config, created_at, updated_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $9, $10)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(protocol)
    .bind(issuer_url)
    .bind(client_id)
    .bind(metadata_url)
    .bind(acs_url)
    .bind(config)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Update an SSO provider's mutable fields.
#[allow(clippy::too_many_arguments)]
pub async fn update_sso_provider(
    pool: &PgPool,
    id: &str,
    name: Option<&str>,
    issuer_url: Option<&str>,
    client_id: Option<&str>,
    metadata_url: Option<&str>,
    acs_url: Option<&str>,
    enabled: Option<bool>,
    config: Option<&serde_json::Value>,
    tenant_id: &str,
) -> Result<Option<SsoProviderRow>, sqlx::Error> {
    sqlx::query_as::<_, SsoProviderRow>(
        "UPDATE auth.sso_providers
         SET name         = COALESCE($1, name),
             issuer_url   = COALESCE($2, issuer_url),
             client_id    = COALESCE($3, client_id),
             metadata_url = COALESCE($4, metadata_url),
             acs_url      = COALESCE($5, acs_url),
             enabled      = COALESCE($6, enabled),
             config       = COALESCE($7, config),
             updated_at   = $8
         WHERE id = $9 AND tenant_id = $10
         RETURNING *",
    )
    .bind(name)
    .bind(issuer_url)
    .bind(client_id)
    .bind(metadata_url)
    .bind(acs_url)
    .bind(enabled)
    .bind(config)
    .bind(now_ms())
    .bind(id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Delete an SSO provider.
pub async fn delete_sso_provider(
    pool: &PgPool,
    id: &str,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM auth.sso_providers WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── WebAuthn Credentials ─────────────────────────────────────────────────

/// List WebAuthn credentials for a user.
pub async fn list_webauthn_credentials(
    pool: &PgPool,
    user_id: &str,
    tenant_id: &str,
) -> Result<Vec<WebAuthnCredentialRow>, sqlx::Error> {
    sqlx::query_as::<_, WebAuthnCredentialRow>(
        "SELECT * FROM auth.webauthn_credentials WHERE user_id = $1 AND tenant_id = $2 ORDER BY created_at DESC",
    )
    .bind(user_id)
    .bind(tenant_id)
    .fetch_all(pool)
    .await
}

/// Create a WebAuthn credential.
#[allow(clippy::too_many_arguments)]
pub async fn create_webauthn_credential(
    pool: &PgPool,
    id: &str,
    user_id: &str,
    credential_id: &str,
    public_key: &str,
    transports: &serde_json::Value,
    tenant_id: &str,
) -> Result<WebAuthnCredentialRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, WebAuthnCredentialRow>(
        "INSERT INTO auth.webauthn_credentials (id, user_id, credential_id, public_key, sign_count, transports, created_at, tenant_id)
         VALUES ($1, $2, $3, $4, 0, $5, $6, $7)
         RETURNING *",
    )
    .bind(id)
    .bind(user_id)
    .bind(credential_id)
    .bind(public_key)
    .bind(transports)
    .bind(now)
    .bind(tenant_id)
    .fetch_one(pool)
    .await
}

/// Delete a WebAuthn credential.
pub async fn delete_webauthn_credential(
    pool: &PgPool,
    id: &str,
    user_id: &str,
    tenant_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM auth.webauthn_credentials WHERE id = $1 AND user_id = $2 AND tenant_id = $3",
    )
    .bind(id)
    .bind(user_id)
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Record a password reset request.
pub async fn create_password_reset(
    pool: &PgPool,
    user_id: &str,
    token_hash: &str,
    tenant_id: &str,
) -> Result<(), sqlx::Error> {
    let now = now_ms();
    let expires = now + 3_600_000; // 1 hour
    sqlx::query(
        "INSERT INTO auth.password_resets (id, user_id, token_hash, expires_at, created_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(uuid::Uuid::now_v7().to_string())
    .bind(user_id)
    .bind(token_hash)
    .bind(expires)
    .bind(now)
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Record a break-glass session.
pub async fn create_break_glass_session(
    pool: &PgPool,
    id: &str,
    user_id: &str,
    reason: &str,
    expires_at: i64,
    tenant_id: &str,
) -> Result<(), sqlx::Error> {
    let now = now_ms();
    sqlx::query(
        "INSERT INTO auth.break_glass_sessions (id, user_id, reason, expires_at, created_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(user_id)
    .bind(reason)
    .bind(expires_at)
    .bind(now)
    .bind(tenant_id)
    .execute(pool)
    .await?;
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
