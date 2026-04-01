//! Google Calendar proxy routes — Calendar API v3.
//!
//! Credentials: OAuth Bearer token from integration config `accessToken` field.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::integrations::proxy::{self, AuthMode};
use crate::state::AppState;

const GCAL_API: &str = "https://www.googleapis.com/calendar/v3";

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/integrations/googlecalendar/calendars",
            get(list_calendars),
        )
        .route(
            "/api/v1/integrations/googlecalendar/events",
            get(list_events),
        )
        .route(
            "/api/v1/integrations/googlecalendar/events/{eventId}",
            get(get_event),
        )
        .route(
            "/api/v1/integrations/googlecalendar/events",
            post(create_event),
        )
        .route(
            "/api/v1/integrations/googlecalendar/events/{eventId}",
            put(update_event),
        )
        .route(
            "/api/v1/integrations/googlecalendar/events/{eventId}",
            delete(delete_event),
        )
        .route(
            "/api/v1/integrations/googlecalendar/freebusy",
            post(freebusy),
        )
}

async fn resolve_auth(state: &AppState) -> Result<AuthMode, (StatusCode, Json<serde_json::Value>)> {
    let pool = state.db().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    ))?;
    let token = proxy::resolve_bearer_token(pool, "googlecalendar", "accessToken").await?;
    Ok(AuthMode::Bearer(token))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventsQuery {
    calendar_id: Option<String>,
    time_min: Option<String>,
    time_max: Option<String>,
    max_results: Option<u32>,
}

async fn list_calendars(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(client) = state.google_calendar() {
        return match client.list_calendars().await {
            Ok(cals) => Json(serde_json::to_value(cals).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_get(GCAL_API, "/users/me/calendarList", &auth, None)
        .await
        .into_response()
}

async fn list_events(
    State(state): State<AppState>,
    Query(q): Query<EventsQuery>,
) -> impl IntoResponse {
    if let Some(client) = state.google_calendar() {
        let cal_id = q.calendar_id.as_deref().unwrap_or("primary");
        return match client
            .list_events(cal_id, q.time_min.as_deref(), q.time_max.as_deref())
            .await
        {
            Ok(events) => Json(serde_json::to_value(events).unwrap()).into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let cal_id = q.calendar_id.as_deref().unwrap_or("primary");
    let mut params = Vec::new();
    if let Some(ref t) = q.time_min {
        params.push(format!("timeMin={t}"));
    }
    if let Some(ref t) = q.time_max {
        params.push(format!("timeMax={t}"));
    }
    if let Some(m) = q.max_results {
        params.push(format!("maxResults={m}"));
    }
    params.push("singleEvents=true".to_string());
    params.push("orderBy=startTime".to_string());
    let qs = if params.is_empty() {
        None
    } else {
        Some(params.join("&"))
    };
    proxy::proxy_get(
        GCAL_API,
        &format!("/calendars/{cal_id}/events"),
        &auth,
        qs.as_deref(),
    )
    .await
    .into_response()
}

async fn get_event(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
) -> impl IntoResponse {
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_get(
        GCAL_API,
        &format!("/calendars/primary/events/{event_id}"),
        &auth,
        None,
    )
    .await
    .into_response()
}

async fn create_event(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    use crate::integrations::google_calendar::EventDateTime;

    if let Some(client) = state.google_calendar() {
        let summary = body
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled Event");
        let start: EventDateTime = body
            .get("start")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or(EventDateTime {
                date_time: None,
                date: None,
                time_zone: None,
            });
        let end: EventDateTime = body
            .get("end")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or(EventDateTime {
                date_time: None,
                date: None,
                time_zone: None,
            });
        let description = body.get("description").and_then(|v| v.as_str());
        let cal_id = body
            .get("calendarId")
            .and_then(|v| v.as_str())
            .unwrap_or("primary");
        return match client
            .create_event(cal_id, summary, &start, &end, description)
            .await
        {
            Ok(event) => (
                StatusCode::CREATED,
                Json(serde_json::to_value(event).unwrap()),
            )
                .into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_post(GCAL_API, "/calendars/primary/events", &auth, &body)
        .await
        .into_response()
}

async fn update_event(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_post(
        GCAL_API,
        &format!("/calendars/primary/events/{event_id}"),
        &auth,
        &body,
    )
    .await
    .into_response()
}

async fn delete_event(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
) -> impl IntoResponse {
    if let Some(client) = state.google_calendar() {
        return match client.delete_event("primary", &event_id).await {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(e) => (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            )
                .into_response(),
        };
    }
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    // Delete needs a custom call — proxy_get doesn't support DELETE
    let url = format!("{GCAL_API}/calendars/primary/events/{event_id}");
    let client = reqwest::Client::new();
    let mut req = client.delete(&url);
    if let AuthMode::Bearer(ref token) = auth {
        req = req.bearer_auth(token);
    }
    match req.send().await {
        Ok(res) if res.status().is_success() => StatusCode::NO_CONTENT.into_response(),
        Ok(res) => {
            let s = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            (
                StatusCode::from_u16(s).unwrap_or(StatusCode::BAD_GATEWAY),
                Json(serde_json::json!({"error": body})),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn freebusy(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    proxy::proxy_post(GCAL_API, "/freeBusy", &auth, &body)
        .await
        .into_response()
}
