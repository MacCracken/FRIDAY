//! Audit routes — log entries query and streaming export.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::stream;
use serde::Deserialize;
use std::convert::Infallible;

use crate::db::audit;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/audit/entries", get(list_entries))
        .route("/api/v1/audit/entries/{id}", get(get_entry))
        .route("/api/v1/audit/stats", get(get_stats))
        .route("/api/v1/audit/export", post(export_entries))
}

#[derive(Deserialize)]
struct AuditQuery {
    event: Option<String>,
    level: Option<String>,
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}

fn default_limit() -> i64 {
    50
}

async fn list_entries(
    State(state): State<AppState>,
    Query(q): Query<AuditQuery>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match audit::list_entries(
        pool,
        "default",
        q.event.as_deref(),
        q.level.as_deref(),
        q.limit.min(1000),
        q.offset,
    )
    .await
    {
        Ok(rows) => Json(serde_json::json!({"entries": rows, "total": rows.len()})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_entry(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match audit::get_entry(pool, &id, "default").await {
        Ok(Some(row)) => Json(serde_json::to_value(row).unwrap()).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Entry not found"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn get_stats(State(state): State<AppState>) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };
    match audit::count_entries(pool, "default").await {
        Ok(count) => Json(serde_json::json!({"totalEntries": count})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

// ── Audit Export (streaming) ─────────────────────────────────────────────

#[derive(Deserialize)]
struct ExportBody {
    format: Option<String>,
    from: Option<i64>,
    to: Option<i64>,
    level: Option<Vec<String>>,
    event: Option<Vec<String>>,
    #[serde(rename = "userId")]
    user_id: Option<String>,
    limit: Option<i64>,
}

const CSV_HEADER: &str = "id,event,level,message,userId,taskId,correlationId,timestamp,metadata\n";

/// Format an audit entry as JSONL (one JSON object per line).
fn format_jsonl(row: &audit::AuditEntryRow) -> String {
    serde_json::to_string(row).unwrap_or_default() + "\n"
}

/// Format an audit entry as a CSV row.
fn format_csv(row: &audit::AuditEntryRow) -> String {
    let ts = chrono::DateTime::from_timestamp(row.timestamp, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default();
    let meta = row
        .metadata
        .as_ref()
        .map(|m| m.to_string())
        .unwrap_or_else(|| "{}".to_string());
    let fields = [
        &row.id,
        &row.event,
        &row.level,
        &row.message,
        row.user_id.as_deref().unwrap_or(""),
        row.task_id.as_deref().unwrap_or(""),
        row.correlation_id.as_deref().unwrap_or(""),
        &ts,
        &meta,
    ];
    fields
        .iter()
        .map(|f| format!("\"{}\"", f.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(",")
        + "\n"
}

/// Format an audit entry as syslog RFC 5424.
fn format_syslog(row: &audit::AuditEntryRow, hostname: &str) -> String {
    let sev = match row.level.as_str() {
        "trace" | "debug" => 7,
        "info" => 6,
        "warn" => 4,
        "error" => 3,
        "security" => 2,
        _ => 6,
    };
    let pri = 8 + sev; // facility=1 (user-level)
    let ts = chrono::DateTime::from_timestamp(row.timestamp, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default();
    let msgid = row.event.replace(' ', "_");
    let msgid = &msgid[..msgid.len().min(32)];
    let uid = row.user_id.as_deref().unwrap_or("-");
    let tid = row.task_id.as_deref().unwrap_or("-");
    format!(
        "<{pri}>1 {ts} {hostname} secureyeoman - {msgid} [secureyeoman@31337 user=\"{uid}\" taskId=\"{tid}\"] {}\n",
        row.message
    )
}

/// POST /api/v1/audit/export — stream audit entries as JSONL, CSV, or syslog.
///
/// Uses SSE for streaming: each entry is sent as a `data` event, allowing the
/// client to process rows incrementally without buffering the entire export.
async fn export_entries(
    State(state): State<AppState>,
    Json(body): Json<ExportBody>,
) -> impl IntoResponse {
    let Some(pool) = state.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "Database not available"})),
        )
            .into_response();
    };

    let fmt = body.format.as_deref().unwrap_or("jsonl");
    if !["jsonl", "csv", "syslog"].contains(&fmt) {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                serde_json::json!({"error": "Invalid format. Must be one of: jsonl, csv, syslog"}),
            ),
        )
            .into_response();
    }

    let limit = body.limit.unwrap_or(100_000);
    let hostname = state.config().host.clone();
    let fmt_owned = fmt.to_string();

    // Fetch entries (capped at limit)
    let rows = match audit::export_entries(
        pool,
        "default",
        body.from,
        body.to,
        body.user_id.as_deref(),
        limit,
    )
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response();
        }
    };

    // Build SSE event list: optional CSV header + one event per row
    let mut events: Vec<Result<Event, Infallible>> = Vec::with_capacity(rows.len() + 1);

    if fmt_owned == "csv" {
        events.push(Ok(Event::default().data(CSV_HEADER.trim_end())));
    }

    for row in &rows {
        let line = match fmt_owned.as_str() {
            "csv" => format_csv(row),
            "syslog" => format_syslog(row, &hostname),
            _ => format_jsonl(row),
        };
        events.push(Ok(Event::default().data(line.trim_end())));
    }

    let event_stream = stream::iter(events);

    Sse::new(event_stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}
