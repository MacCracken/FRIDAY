//! Google Calendar API client — typed wrapper around the Calendar API v3.
//!
//! Credentials: OAuth Bearer token.
//! Config field: `accessToken`.

use reqwest::header::AUTHORIZATION;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;

use crate::db::integrations;

const DEFAULT_BASE_URL: &str = "https://www.googleapis.com/calendar/v3";

fn base_url() -> String {
    std::env::var("GCAL_API_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
}

// ── Error ────────────────────────────────────────────────────────────────────

/// Errors returned by the Google Calendar client.
#[derive(Debug, Error)]
pub enum IntegrationError {
    /// HTTP transport error.
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),
    /// Upstream returned a non-success status.
    #[error("provider error ({status}): {body}")]
    Provider { status: u16, body: String },
    /// Credential resolution failed.
    #[error("credential error: {0}")]
    Credential(String),
    /// Database error.
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

// ── Response types ────────────────────────────────────────────────────────────

/// A Google Calendar entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Calendar {
    pub id: String,
    pub summary: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, rename = "accessRole")]
    pub access_role: Option<String>,
}

/// Calendar list response.
#[derive(Debug, Deserialize)]
struct CalendarListResponse {
    #[serde(default)]
    items: Vec<Calendar>,
}

/// A Google Calendar event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub id: String,
    #[serde(default)]
    pub summary: Option<String>,
    pub start: EventDateTime,
    pub end: EventDateTime,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "htmlLink", default)]
    pub html_link: Option<String>,
}

/// Event start/end time — either a datetime or a date (all-day).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventDateTime {
    #[serde(rename = "dateTime", default)]
    pub date_time: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(rename = "timeZone", default)]
    pub time_zone: Option<String>,
}

/// Event list response.
#[derive(Debug, Deserialize)]
struct EventListResponse {
    #[serde(default)]
    items: Vec<CalendarEvent>,
}

// ── Request bodies ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct CreateEventBody<'a> {
    summary: &'a str,
    start: &'a EventDateTime,
    end: &'a EventDateTime,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
}

// ── Client ────────────────────────────────────────────────────────────────────

/// Typed Google Calendar API v3 client.
pub struct GoogleCalendarClient {
    client: reqwest::Client,
    token: String,
}

impl GoogleCalendarClient {
    /// Create a client from an OAuth access token.
    pub fn new(token: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            token: token.into(),
        }
    }

    /// Resolve credentials from the database and build a client.
    pub async fn from_pool(pool: &PgPool, platform: &str) -> Result<Self, IntegrationError> {
        let row = integrations::find_enabled_by_platform(pool, platform)
            .await?
            .ok_or_else(|| {
                IntegrationError::Credential(format!("No enabled {platform} integration found"))
            })?;
        let token = row
            .config
            .get("accessToken")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                IntegrationError::Credential(
                    "Integration missing `accessToken` in config".to_string(),
                )
            })?
            .to_string();
        Ok(Self::new(token))
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn auth_header(&self) -> String {
        format!("Bearer {}", self.token)
    }

    async fn get<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        query: Option<&str>,
    ) -> Result<T, IntegrationError> {
        let base = base_url();
        let url = match query {
            Some(q) if !q.is_empty() => format!("{base}{path}?{q}"),
            _ => format!("{base}{path}"),
        };
        let res = self
            .client
            .get(&url)
            .header(AUTHORIZATION, self.auth_header())
            .send()
            .await?;
        if res.status().is_success() {
            Ok(res.json().await?)
        } else {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            Err(IntegrationError::Provider { status, body })
        }
    }

    async fn post<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, IntegrationError> {
        let url = format!("{}{path}", base_url());
        let res = self
            .client
            .post(&url)
            .header(AUTHORIZATION, self.auth_header())
            .json(body)
            .send()
            .await?;
        if res.status().is_success() {
            Ok(res.json().await?)
        } else {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            Err(IntegrationError::Provider { status, body })
        }
    }

    async fn put<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, IntegrationError> {
        let url = format!("{}{path}", base_url());
        let res = self
            .client
            .put(&url)
            .header(AUTHORIZATION, self.auth_header())
            .json(body)
            .send()
            .await?;
        if res.status().is_success() {
            Ok(res.json().await?)
        } else {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            Err(IntegrationError::Provider { status, body })
        }
    }

    async fn delete_empty(&self, path: &str) -> Result<(), IntegrationError> {
        let url = format!("{}{path}", base_url());
        let res = self
            .client
            .delete(&url)
            .header(AUTHORIZATION, self.auth_header())
            .send()
            .await?;
        if res.status().is_success() {
            Ok(())
        } else {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            Err(IntegrationError::Provider { status, body })
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /// List calendars in the authenticated user's calendar list.
    pub async fn list_calendars(&self) -> Result<Vec<Calendar>, IntegrationError> {
        let resp: CalendarListResponse = self.get("/users/me/calendarList", None).await?;
        Ok(resp.items)
    }

    /// List events in a calendar within an optional time range.
    ///
    /// `time_min` and `time_max` are RFC 3339 timestamps.
    pub async fn list_events(
        &self,
        calendar_id: &str,
        time_min: Option<&str>,
        time_max: Option<&str>,
    ) -> Result<Vec<CalendarEvent>, IntegrationError> {
        let mut params = vec![
            "singleEvents=true".to_string(),
            "orderBy=startTime".to_string(),
        ];
        if let Some(t) = time_min {
            params.push(format!("timeMin={t}"));
        }
        if let Some(t) = time_max {
            params.push(format!("timeMax={t}"));
        }
        let resp: EventListResponse = self
            .get(
                &format!("/calendars/{calendar_id}/events"),
                Some(&params.join("&")),
            )
            .await?;
        Ok(resp.items)
    }

    /// Create an event in a calendar.
    pub async fn create_event(
        &self,
        calendar_id: &str,
        summary: &str,
        start: &EventDateTime,
        end: &EventDateTime,
        description: Option<&str>,
    ) -> Result<CalendarEvent, IntegrationError> {
        let body = CreateEventBody {
            summary,
            start,
            end,
            description,
        };
        self.post(&format!("/calendars/{calendar_id}/events"), &body)
            .await
    }

    /// Update an existing event (full PUT replacement).
    pub async fn update_event(
        &self,
        calendar_id: &str,
        event_id: &str,
        summary: &str,
        start: &EventDateTime,
        end: &EventDateTime,
    ) -> Result<CalendarEvent, IntegrationError> {
        let body = CreateEventBody {
            summary,
            start,
            end,
            description: None,
        };
        self.put(
            &format!("/calendars/{calendar_id}/events/{event_id}"),
            &body,
        )
        .await
    }

    /// Delete an event.
    pub async fn delete_event(
        &self,
        calendar_id: &str,
        event_id: &str,
    ) -> Result<(), IntegrationError> {
        self.delete_empty(&format!("/calendars/{calendar_id}/events/{event_id}"))
            .await
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_calendar() {
        let json = r#"{"id":"primary","summary":"My Calendar","accessRole":"owner"}"#;
        let cal: Calendar = serde_json::from_str(json).unwrap();
        assert_eq!(cal.id, "primary");
        assert_eq!(cal.summary, "My Calendar");
    }

    #[test]
    fn deserialize_calendar_event() {
        let json = r#"{"id":"evt-1","summary":"Team Standup","start":{"dateTime":"2026-04-01T09:00:00Z","timeZone":"UTC"},"end":{"dateTime":"2026-04-01T09:30:00Z","timeZone":"UTC"}}"#;
        let event: CalendarEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.id, "evt-1");
        assert_eq!(
            event.start.date_time.as_deref(),
            Some("2026-04-01T09:00:00Z")
        );
    }

    #[test]
    fn deserialize_all_day_event() {
        let json = r#"{"id":"evt-2","summary":"Holiday","start":{"date":"2026-04-01"},"end":{"date":"2026-04-02"}}"#;
        let event: CalendarEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.start.date.as_deref(), Some("2026-04-01"));
        assert!(event.start.date_time.is_none());
    }

    #[test]
    fn create_event_body_serializes() {
        let start = EventDateTime {
            date_time: Some("2026-04-01T09:00:00Z".to_string()),
            date: None,
            time_zone: Some("UTC".to_string()),
        };
        let end = EventDateTime {
            date_time: Some("2026-04-01T10:00:00Z".to_string()),
            date: None,
            time_zone: Some("UTC".to_string()),
        };
        let body = CreateEventBody {
            summary: "Meeting",
            start: &start,
            end: &end,
            description: None,
        };
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("Meeting"));
        assert!(!json.contains("description"));
    }

    #[test]
    fn base_url_uses_env_override() {
        // SAFETY: single-threaded test; no other threads reading this var.
        unsafe { std::env::remove_var("GCAL_API_URL") };
        assert_eq!(base_url(), DEFAULT_BASE_URL);
    }
}
