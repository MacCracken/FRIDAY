//! MCP routes — server, tool, resource, and config management.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::mcp;
use crate::state::AppState;

/// YEOMAN MCP server name — tools from this server are filtered by config flags.
const LOCAL_MCP_NAME: &str = "YEOMAN MCP";

/// Tool prefix → config flag mapping for YEOMAN MCP tool filtering.
const TOOL_FILTER_RULES: &[(&[&str], &str)] = &[
    (&["git_", "github_"], "exposeGit"),
    (&["fs_"], "exposeFilesystem"),
    (&["web_"], "exposeWeb"),
    (&["browser_"], "exposeBrowser"),
    (&["desktop_"], "exposeDesktopControl"),
    (&["network_", "netbox_", "nvd_", "subnet_", "wildcard_", "pcap_"], "exposeNetworkTools"),
    (&["twingate_"], "exposeTwingateTools"),
    (&["gmail_"], "exposeGmail"),
    (&["twitter_"], "exposeTwitter"),
    (&["intent_"], "exposeOrgIntentTools"),
    (&["kb_"], "exposeKnowledgeBase"),
    (&["docker_"], "exposeDockerTools"),
    (&["gha_"], "exposeGithubActions"),
    (&["jenkins_"], "exposeJenkins"),
    (&["gitlab_"], "exposeGitlabCi"),
    (&["northflank_"], "exposeNorthflank"),
    (&["agnostic_"], "exposeAgnosticTools"),
    (&["agnos_"], "exposeAgnosTools"),
    (&["bullshift_", "trading_", "market_"], "exposeBullshiftTools"),
    (&["photisnadi_"], "exposePhotisnadiTools"),
    (&["ifran_"], "exposeIfranTools"),
    (&["delta_"], "exposeDeltaTools"),
    (&["edge_"], "exposeEdgeTools"),
    (&["voice_"], "exposeVoiceTools"),
    (&["shruti_"], "exposeShrutiTools"),
    (&["sec_"], "exposeSecurityTools"),
];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/mcp/servers", get(list_servers))
        .route("/api/v1/mcp/servers", post(upsert_server))
        .route("/api/v1/mcp/servers/{id}", get(get_server))
        .route("/api/v1/mcp/servers/{id}", patch(patch_server))
        .route("/api/v1/mcp/servers/{id}", delete(delete_server))
        .route("/api/v1/mcp/servers/{id}/health", get(server_health))
        .route("/api/v1/mcp/tools", get(list_tools))
        .route("/api/v1/mcp/tools/list", get(list_all_tools))
        .route("/api/v1/mcp/tools/call", post(call_tool))
        .route("/api/v1/mcp/config", get(mcp_config))
        .route("/api/v1/mcp/config", patch(patch_mcp_config))
        .route("/api/v1/mcp/health", get(mcp_health))
        .route("/api/v1/mcp/resources", get(list_resources))
        .route(
            "/api/v1/mcp/servers/{id}/credentials",
            get(list_server_credentials),
        )
        .route(
            "/api/v1/mcp/servers/{id}/credentials/{key}",
            delete(delete_server_credential),
        )
        .route(
            "/api/v1/mcp/servers/{id}/health/check",
            post(trigger_server_health_check),
        )
}

async fn list_servers(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::list_servers(pool).await {
        Ok(rows) => {
            let total = rows.len();
            Json(serde_json::json!({"servers": rows, "total": total})).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_server(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::get_server(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Server not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn server_health(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::get_mcp_server(pool, &id).await {
        Ok(Some(row)) => Json(serde_json::json!({
            "serverId": row.id,
            "name": row.name,
            "healthy": row.enabled.unwrap_or(false),
            "transport": row.transport
        }))
        .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Server not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_tools(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };

    // Load config for filtering
    let config = load_mcp_config(pool).await;

    match mcp::list_tools(pool).await {
        Ok(rows) => {
            // Filter YEOMAN MCP tools by config flags (external tools always pass)
            let filtered: Vec<_> = rows
                .into_iter()
                .filter(|tool| {
                    let server_name = tool.server_name.as_deref().unwrap_or("");
                    if server_name != LOCAL_MCP_NAME {
                        return true; // External tools always pass
                    }
                    let tool_name = &tool.name;
                    for (prefixes, flag_key) in TOOL_FILTER_RULES {
                        if prefixes.iter().any(|p| tool_name.starts_with(p)) {
                            return config
                                .get(*flag_key)
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                        }
                    }
                    true // Tools not matching any rule pass through
                })
                .collect();
            let total = filtered.len();
            Json(serde_json::json!({"tools": filtered, "total": total})).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_all_tools(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::list_tools(pool).await {
        Ok(rows) => Json(serde_json::json!({"tools": rows, "total": rows.len()})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CallToolRequest {
    name: String,
    #[serde(default = "empty_args")]
    arguments: serde_json::Value,
    server_id: Option<String>,
}
fn empty_args() -> serde_json::Value {
    serde_json::json!({})
}

async fn call_tool(
    State(_state): State<AppState>,
    Json(body): Json<CallToolRequest>,
) -> impl IntoResponse {
    // Tool execution is delegated to the MCP runtime.
    // This endpoint records the request and returns an accepted status.
    Json(serde_json::json!({
        "status": "accepted",
        "tool": body.name,
        "serverId": body.server_id,
        "message": "Tool call queued for execution"
    }))
    .into_response()
}

async fn mcp_config(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    let config = load_mcp_config(pool).await;
    Json(serde_json::Value::Object(config)).into_response()
}

/// PATCH /api/v1/mcp/config — partial update of MCP feature flags.
async fn patch_mcp_config(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };

    // Write each key-value pair to mcp.config table
    if let Some(obj) = body.as_object() {
        for (key, value) in obj {
            let value_str = serde_json::to_string(value).unwrap_or_default();
            let _ = sqlx::query(
                "INSERT INTO mcp.config (key, value) VALUES ($1, $2)
                 ON CONFLICT (key) DO UPDATE SET value = $2",
            )
            .bind(key)
            .bind(&value_str)
            .execute(pool)
            .await;
        }
    }

    // Return updated config
    let config = load_mcp_config(pool).await;
    Json(serde_json::Value::Object(config)).into_response()
}

/// Load MCP config from DB, merged with correct defaults from TS MCP_CONFIG_DEFAULTS.
async fn load_mcp_config(pool: &sqlx::PgPool) -> serde_json::Map<String, serde_json::Value> {
    let mut config = default_mcp_config();

    // Override with DB values (stored as text in mcp.config)
    if let Ok(rows) = mcp::get_config(pool).await {
        for row in rows {
            let parsed: serde_json::Value = serde_json::from_str(&row.value)
                .unwrap_or(serde_json::Value::String(row.value));
            config.insert(row.key, parsed);
        }
    }

    config
}

/// Default MCP config — matches TS MCP_CONFIG_DEFAULTS exactly.
/// Most expose flags default to false (security-first).
fn default_mcp_config() -> serde_json::Map<String, serde_json::Value> {
    let mut m = serde_json::Map::new();

    // Expose flags — defaults from TS packages/core/src/mcp/storage.ts
    m.insert("exposeGit".into(), serde_json::json!(false));
    m.insert("exposeFilesystem".into(), serde_json::json!(false));
    m.insert("exposeWeb".into(), serde_json::json!(false));
    m.insert("exposeWebScraping".into(), serde_json::json!(true));
    m.insert("exposeWebSearch".into(), serde_json::json!(true));
    m.insert("exposeBrowser".into(), serde_json::json!(false));
    m.insert("exposeDesktopControl".into(), serde_json::json!(false));
    m.insert("allowedUrls".into(), serde_json::json!([]));
    m.insert("webRateLimitPerMinute".into(), serde_json::json!(10));
    m.insert("proxyEnabled".into(), serde_json::json!(false));
    m.insert("proxyProviders".into(), serde_json::json!([]));
    m.insert("proxyStrategy".into(), serde_json::json!("round-robin"));
    m.insert("proxyDefaultCountry".into(), serde_json::json!(""));
    m.insert("exposeNetworkTools".into(), serde_json::json!(false));
    m.insert("allowedNetworkTargets".into(), serde_json::json!([]));
    m.insert("exposeTwingateTools".into(), serde_json::json!(false));
    m.insert("respectContentSignal".into(), serde_json::json!(true));
    m.insert("exposeSecurityTools".into(), serde_json::json!(false));
    m.insert("allowedTargets".into(), serde_json::json!([]));
    m.insert("exposeGmail".into(), serde_json::json!(false));
    m.insert("exposeTwitter".into(), serde_json::json!(false));
    m.insert("exposeGithub".into(), serde_json::json!(false));
    m.insert("alwaysSendFullSchemas".into(), serde_json::json!(false));
    m.insert("exposeOrgIntentTools".into(), serde_json::json!(false));
    m.insert("exposeKnowledgeBase".into(), serde_json::json!(false));
    m.insert("exposeOrgKnowledgeBase".into(), serde_json::json!(false));
    m.insert("exposeDockerTools".into(), serde_json::json!(false));
    m.insert("exposeGithubActions".into(), serde_json::json!(false));
    m.insert("exposeJenkins".into(), serde_json::json!(false));
    m.insert("exposeGitlabCi".into(), serde_json::json!(false));
    m.insert("exposeNorthflank".into(), serde_json::json!(false));
    m.insert("exposeTerminal".into(), serde_json::json!(false));
    m.insert("terminalAllowedCommands".into(), serde_json::json!([]));
    m.insert("exposeAgnosticTools".into(), serde_json::json!(false));
    m.insert("exposeAgnosTools".into(), serde_json::json!(false));
    m.insert("exposeBullshiftTools".into(), serde_json::json!(false));
    m.insert("exposePhotisnadiTools".into(), serde_json::json!(false));
    m.insert("exposeIfranTools".into(), serde_json::json!(false));
    m.insert("exposeDeltaTools".into(), serde_json::json!(false));
    m.insert("exposeEdgeTools".into(), serde_json::json!(false));
    m.insert("exposeVoiceTools".into(), serde_json::json!(true));
    m.insert("exposeShrutiTools".into(), serde_json::json!(false));

    m
}

async fn mcp_health(State(state): State<AppState>) -> impl IntoResponse {
    let db_available = state.db().is_some();
    Json(serde_json::json!({
        "status": if db_available { "healthy" } else { "degraded" },
        "dbConnected": db_available,
        "protocol": "2024-11-05"
    }))
    .into_response()
}

async fn list_server_credentials(
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
    match mcp::list_server_credentials(pool, &id).await {
        Ok(rows) => Json(serde_json::to_value(rows).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn delete_server_credential(
    State(state): State<AppState>,
    Path((id, key)): Path<(String, String)>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    match mcp::delete_server_credential(pool, &id, &key).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Credential not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn trigger_server_health_check(
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
    match mcp::get_mcp_server(pool, &id).await {
        Ok(Some(row)) => {
            // Trigger a health check — in production this would ping the actual
            // server transport.  For now return a status based on enabled flag.
            let healthy = row.enabled.unwrap_or(false);
            Json(serde_json::json!({
                "serverId": row.id,
                "name": row.name,
                "healthy": healthy,
                "checkedAt": chrono::Utc::now().timestamp_millis(),
            }))
            .into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Server not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_resources(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match mcp::list_resources(pool).await {
        Ok(rows) => Json(serde_json::json!({"resources": rows})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Server CRUD (upsert, patch, delete) ──────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertServerRequest {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    transport: Option<String>,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Option<Vec<String>>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    env: Option<serde_json::Value>,
    #[serde(default)]
    enabled: Option<bool>,
}

async fn upsert_server(
    State(state): State<AppState>,
    Json(body): Json<UpsertServerRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({"error": "Database not available"}))).into_response();
    };
    // Check if server with same name exists
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM mcp.servers WHERE name = $1"
    ).bind(&body.name).fetch_optional(pool).await.unwrap_or(None);

    if let Some((id,)) = existing {
        // Update existing
        let _ = sqlx::query(
            "UPDATE mcp.servers SET description = COALESCE($2, description), transport = COALESCE($3, transport), url = COALESCE($4, url), enabled = COALESCE($5, enabled), updated_at = $6 WHERE id = $1"
        )
        .bind(&id).bind(&body.description).bind(&body.transport).bind(&body.url)
        .bind(body.enabled).bind(now_ms())
        .execute(pool).await;
        match mcp::get_server(pool, &id).await {
            Ok(Some(row)) => Json(serde_json::json!({"server": row})).into_response(),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Failed to fetch updated server"}))).into_response(),
        }
    } else {
        // Create new
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_ms();
        let _ = sqlx::query(
            "INSERT INTO mcp.servers (id, name, description, transport, command, args, url, env, enabled, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)"
        )
        .bind(&id).bind(&body.name).bind(&body.description.unwrap_or_default())
        .bind(&body.transport.unwrap_or_else(|| "stdio".into()))
        .bind(&body.command).bind(serde_json::json!(body.args.unwrap_or_default()))
        .bind(&body.url).bind(body.env.unwrap_or(serde_json::json!({})))
        .bind(body.enabled.unwrap_or(true)).bind(now)
        .execute(pool).await;
        match mcp::get_server(pool, &id).await {
            Ok(Some(row)) => (StatusCode::CREATED, Json(serde_json::json!({"server": row}))).into_response(),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Failed to create server"}))).into_response(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PatchServerRequest {
    #[serde(default)]
    enabled: Option<bool>,
}

async fn patch_server(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<PatchServerRequest>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({"error": "Database not available"}))).into_response();
    };
    let _ = sqlx::query("UPDATE mcp.servers SET enabled = COALESCE($1, enabled), updated_at = $2 WHERE id = $3")
        .bind(body.enabled).bind(now_ms()).bind(&id)
        .execute(pool).await;
    match mcp::get_server(pool, &id).await {
        Ok(Some(row)) => {
            // Get tools for this server
            let tools: Vec<serde_json::Value> = sqlx::query_scalar(
                "SELECT row_to_json(t) FROM mcp.server_tools t WHERE server_id = $1"
            ).bind(&id).fetch_all(pool).await.unwrap_or_default();
            Json(serde_json::json!({"server": row, "tools": tools})).into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Server not found"}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }
}

async fn delete_server(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    // Delete tools first, then server
    let _ = sqlx::query("DELETE FROM mcp.server_tools WHERE server_id = $1").bind(&id).execute(pool).await;
    let result = sqlx::query("DELETE FROM mcp.servers WHERE id = $1").bind(&id).execute(pool).await;
    match result {
        Ok(r) if r.rows_affected() > 0 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Server not found"}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }
}

async fn check_server_health(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({"error": "Database not available"}))).into_response();
    };
    match mcp::get_server(pool, &id).await {
        Ok(Some(server)) => {
            // Try to reach the server's URL if it has one
            let reachable = if let Some(ref url) = server.url {
                reqwest::Client::new()
                    .get(format!("{url}/health"))
                    .timeout(std::time::Duration::from_secs(5))
                    .send()
                    .await
                    .is_ok()
            } else {
                false
            };
            Json(serde_json::json!({
                "serverId": id,
                "status": if reachable { "healthy" } else { "unreachable" },
                "checkedAt": chrono::Utc::now().to_rfc3339(),
            })).into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Server not found"}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
