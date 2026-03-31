//! Extension storage.
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifestRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
}

/// Extension hook row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionHookRow {
    pub id: String,
    pub extension_id: String,
    pub event: String,
    pub handler: String,
    pub created_at: i64,
}

/// Extension webhook row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionWebhookRow {
    pub id: String,
    pub extension_id: String,
    pub url: String,
    pub secret: Option<String>,
    pub events: serde_json::Value,
    pub created_at: i64,
}

pub async fn list_extensions(pool: &PgPool) -> Result<Vec<ExtensionManifestRow>, sqlx::Error> {
    sqlx::query_as::<_, ExtensionManifestRow>(
        "SELECT id, name, description, version, enabled, created_at FROM extensions.manifests ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await
}

/// Get an extension by ID.
pub async fn get_extension(
    pool: &PgPool,
    id: &str,
) -> Result<Option<ExtensionManifestRow>, sqlx::Error> {
    sqlx::query_as::<_, ExtensionManifestRow>(
        "SELECT id, name, description, version, enabled, created_at FROM extensions.manifests WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Create a new extension.
pub async fn create_extension(
    pool: &PgPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    version: Option<&str>,
) -> Result<ExtensionManifestRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ExtensionManifestRow>(
        "INSERT INTO extensions.manifests (id, name, description, version, enabled, created_at)
         VALUES ($1, $2, $3, $4, true, $5)
         RETURNING *",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(version)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Delete an extension by ID.
pub async fn delete_extension(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM extensions.manifests WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// List hooks.
pub async fn list_hooks(pool: &PgPool) -> Result<Vec<ExtensionHookRow>, sqlx::Error> {
    sqlx::query_as::<_, ExtensionHookRow>(
        "SELECT id, extension_id, event, handler, created_at FROM extensions.hooks ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
}

/// Create a hook.
pub async fn create_hook(
    pool: &PgPool,
    id: &str,
    extension_id: &str,
    event: &str,
    handler: &str,
) -> Result<ExtensionHookRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ExtensionHookRow>(
        "INSERT INTO extensions.hooks (id, extension_id, event, handler, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *",
    )
    .bind(id)
    .bind(extension_id)
    .bind(event)
    .bind(handler)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// List webhooks.
pub async fn list_webhooks(pool: &PgPool) -> Result<Vec<ExtensionWebhookRow>, sqlx::Error> {
    sqlx::query_as::<_, ExtensionWebhookRow>(
        "SELECT id, extension_id, url, secret, events, created_at FROM extensions.webhooks ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
}

/// Create a webhook.
pub async fn create_webhook(
    pool: &PgPool,
    id: &str,
    extension_id: &str,
    url: &str,
    secret: Option<&str>,
    events: &serde_json::Value,
) -> Result<ExtensionWebhookRow, sqlx::Error> {
    let now = now_ms();
    sqlx::query_as::<_, ExtensionWebhookRow>(
        "INSERT INTO extensions.webhooks (id, extension_id, url, secret, events, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *",
    )
    .bind(id)
    .bind(extension_id)
    .bind(url)
    .bind(secret)
    .bind(events)
    .bind(now)
    .fetch_one(pool)
    .await
}

/// Get extension config (returns a JSON blob from the config table).
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionConfigRow {
    pub key: String,
    pub value: serde_json::Value,
}

pub async fn get_config(pool: &PgPool) -> Result<Vec<ExtensionConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, ExtensionConfigRow>(
        "SELECT key, value FROM extensions.config ORDER BY key ASC",
    )
    .fetch_all(pool)
    .await
}

/// Delete a hook by ID.
pub async fn delete_hook(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM extensions.hooks WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Get a single hook by ID.
pub async fn get_hook(pool: &PgPool, id: &str) -> Result<Option<ExtensionHookRow>, sqlx::Error> {
    sqlx::query_as::<_, ExtensionHookRow>(
        "SELECT id, extension_id, event, handler, created_at FROM extensions.hooks WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

/// Hook execution log row.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HookLogRow {
    pub id: String,
    pub hook_id: String,
    pub status: String,
    pub executed_at: i64,
}

/// List hook execution log entries.
pub async fn get_hooks_log(pool: &PgPool) -> Result<Vec<HookLogRow>, sqlx::Error> {
    sqlx::query_as::<_, HookLogRow>(
        "SELECT id, hook_id, status, executed_at FROM extensions.hook_log ORDER BY executed_at DESC LIMIT 100",
    )
    .fetch_all(pool)
    .await
}

/// Update a webhook.
pub async fn update_webhook(
    pool: &PgPool,
    id: &str,
    url: Option<&str>,
    secret: Option<&str>,
    events: Option<&serde_json::Value>,
) -> Result<Option<ExtensionWebhookRow>, sqlx::Error> {
    // Build dynamic update — at minimum touch the row to confirm it exists.
    let now = now_ms();
    if let Some(u) = url {
        sqlx::query("UPDATE extensions.webhooks SET url = $2 WHERE id = $1")
            .bind(id)
            .bind(u)
            .execute(pool)
            .await?;
    }
    if let Some(s) = secret {
        sqlx::query("UPDATE extensions.webhooks SET secret = $2 WHERE id = $1")
            .bind(id)
            .bind(s)
            .execute(pool)
            .await?;
    }
    if let Some(e) = events {
        sqlx::query("UPDATE extensions.webhooks SET events = $2 WHERE id = $1")
            .bind(id)
            .bind(e)
            .execute(pool)
            .await?;
    }
    let _ = now;
    sqlx::query_as::<_, ExtensionWebhookRow>(
        "SELECT id, extension_id, url, secret, events, created_at FROM extensions.webhooks WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
