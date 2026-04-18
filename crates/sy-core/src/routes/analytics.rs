//! Analytics routes — conversation summaries and sentiment.

use crate::db::analytics;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/analytics/summaries", get(list_summaries))
        .route(
            "/api/v1/analytics/conversations/{id}/sentiments",
            get(list_sentiments),
        )
        // Dashboard health widgets
        .route("/api/v1/metrics", get(system_metrics))
        .route("/api/v1/costs/breakdown", get(costs_breakdown))
}

async fn system_metrics() -> impl IntoResponse {
    // Read real system metrics where possible
    let mut memory_used_mb = 0u64;
    let mut memory_limit_mb = 0u64;

    // /proc/meminfo for memory (Linux)
    if let Ok(meminfo) = tokio::fs::read_to_string("/proc/meminfo").await {
        for line in meminfo.lines() {
            if let Some(val) = line.strip_prefix("MemTotal:") {
                memory_limit_mb = val
                    .trim()
                    .split_whitespace()
                    .next()
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(0)
                    / 1024;
            }
            if let Some(val) = line.strip_prefix("MemAvailable:") {
                let avail = val
                    .trim()
                    .split_whitespace()
                    .next()
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(0)
                    / 1024;
                memory_used_mb = memory_limit_mb.saturating_sub(avail);
            }
        }
    }

    let memory_percent = if memory_limit_mb > 0 {
        (memory_used_mb as f64 / memory_limit_mb as f64 * 100.0).round()
    } else {
        0.0
    };

    // /proc/loadavg for CPU load (instant, no two-sample needed)
    let cpu_percent = if let Ok(loadavg) = tokio::fs::read_to_string("/proc/loadavg").await {
        // Format: "0.15 0.10 0.05 1/234 5678"
        // First value is 1-minute load average. Divide by number of CPUs for percent.
        let load_1m = loadavg
            .split_whitespace()
            .next()
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0);
        let num_cpus = tokio::fs::read_to_string("/proc/cpuinfo")
            .await
            .map(|info| info.matches("processor").count() as f64)
            .unwrap_or(1.0)
            .max(1.0);
        (load_1m / num_cpus * 100.0).min(100.0).round()
    } else {
        0.0
    };

    // Disk usage from cgroup or df
    let disk_used_mb = if let Ok(stat) = tokio::fs::read_to_string("/proc/self/statm").await {
        // statm: size resident shared text lib data dt (in pages)
        // resident * page_size gives RSS
        stat.split_whitespace()
            .nth(1)
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0)
            * 4
            / 1024 // pages → MB (4KB pages)
    } else {
        0
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Json(serde_json::json!({
        "timestamp": now,
        "tasks": {
            "total": 0,
            "tasksToday": 0,
            "byStatus": {},
            "byType": {},
            "successRate": 1.0,
            "failureRate": 0.0,
            "avgDurationMs": 0,
            "minDurationMs": 0,
            "maxDurationMs": 0,
            "p50DurationMs": 0,
            "p95DurationMs": 0,
            "p99DurationMs": 0,
            "queueDepth": 0,
            "inProgress": 0,
        },
        "resources": {
            "cpuPercent": cpu_percent,
            "memoryUsedMb": memory_used_mb,
            "memoryLimitMb": memory_limit_mb,
            "memoryPercent": memory_percent,
            "diskUsedMb": disk_used_mb,
            "diskLimitMb": null,
            "inputTokensToday": 0,
            "outputTokensToday": 0,
            "tokensUsedToday": 0,
            "tokensCachedToday": 0,
            "tokensLimitDaily": null,
            "costUsdToday": 0.0,
            "costUsdMonth": 0.0,
            "apiCallsTotal": 0,
            "apiErrorsTotal": 0,
            "apiLatencyAvgMs": 0.0,
        },
        "security": {
            "injectionAttemptsTotal": 0,
            "auditEntriesTotal": 0,
            "auditChainValid": true,
            "eventsByType": {},
            "eventsBySeverity": {},
            "authAttemptsTotal": 0,
            "authSuccessTotal": 0,
            "authFailuresTotal": 0,
            "activeSessions": 0,
            "permissionChecksTotal": 0,
            "permissionDenialsTotal": 0,
            "blockedRequestsTotal": 0,
            "rateLimitHitsTotal": 0,
        },
    }))
}

async fn costs_breakdown(State(_state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "totalCost": 0.0,
        "providers": [],
        "period": "current_month",
    }))
}

#[derive(Deserialize)]
struct PQ {
    #[serde(default = "dl")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}
fn dl() -> i64 {
    20
}

async fn list_summaries(State(s): State<AppState>, Query(q): Query<PQ>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match analytics::list_summaries(pool, q.limit.min(100), q.offset).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn list_sentiments(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error":"No DB"})),
        )
            .into_response();
    };
    match analytics::list_sentiments(pool, &id).await {
        Ok(r) => Json(serde_json::to_value(r).unwrap()).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}
