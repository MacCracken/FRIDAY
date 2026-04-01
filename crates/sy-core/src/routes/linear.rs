//! Linear proxy routes — GraphQL API.
//!
//! Credentials: API key from integration config `apiKey` field.
//! All queries forwarded as GraphQL to https://api.linear.app/graphql.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};

use crate::integrations::proxy::{self, AuthMode};
use crate::state::AppState;

const LINEAR_API: &str = "https://api.linear.app";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/integrations/linear/teams", get(list_teams))
        .route("/api/v1/integrations/linear/issues", get(list_issues))
}

async fn resolve_auth(state: &AppState) -> Result<AuthMode, (StatusCode, Json<serde_json::Value>)> {
    let pool = state.db().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"error": "Database not available"})),
    ))?;
    let key = proxy::resolve_bearer_token(pool, "linear", "apiKey").await?;
    Ok(AuthMode::Bearer(key))
}

async fn list_teams(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(client) = state.linear() {
        return match client.list_teams().await {
            Ok(teams) => Json(serde_json::to_value(teams).unwrap()).into_response(),
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
    let query = serde_json::json!({
        "query": "{ teams { nodes { id name key } } }"
    });
    proxy::proxy_post(LINEAR_API, "/graphql", &auth, &query)
        .await
        .into_response()
}

async fn list_issues(State(state): State<AppState>) -> impl IntoResponse {
    if let Some(client) = state.linear() {
        // List issues across all teams using the first team as a representative query.
        // For a cross-team view, fall through to the raw proxy path which uses
        // the full issues query without a team filter.
        // The typed client's list_issues requires a team_id; skip to proxy fallback
        // so the full cross-team query is preserved when no team is specified.
        let _ = client; // client available but proxy path is richer here
    }
    let auth = match resolve_auth(&state).await {
        Ok(a) => a,
        Err(e) => return e.into_response(),
    };
    let query = serde_json::json!({
        "query": "{ issues(first: 50, orderBy: updatedAt) { nodes { id title state { name } priority assignee { name } updatedAt } } }"
    });
    proxy::proxy_post(LINEAR_API, "/graphql", &auth, &query)
        .await
        .into_response()
}
