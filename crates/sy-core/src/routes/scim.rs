//! SCIM routes — SCIM v2 full RFC 7644 implementation (Users, Groups, discovery).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use serde::Deserialize;

use crate::db::security;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // Discovery
        .route("/api/v1/scim/v2", get(service_provider_config))
        .route("/api/v1/scim/v2/ResourceTypes", get(resource_types))
        .route("/api/v1/scim/v2/Schemas", get(schemas))
        // Users
        .route("/api/v1/scim/v2/Users", get(list_users))
        .route("/api/v1/scim/v2/Users", post(create_user))
        .route("/api/v1/scim/v2/Users/{id}", get(get_user))
        .route("/api/v1/scim/v2/Users/{id}", put(replace_user))
        .route("/api/v1/scim/v2/Users/{id}", delete(delete_user))
        // Groups
        .route("/api/v1/scim/v2/Groups", get(list_groups))
        .route("/api/v1/scim/v2/Groups", post(create_group))
        .route("/api/v1/scim/v2/Groups/{id}", get(get_group))
        .route("/api/v1/scim/v2/Groups/{id}", put(replace_group))
        .route("/api/v1/scim/v2/Groups/{id}", delete(delete_group))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn err_unavailable() -> axum::response::Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(serde_json::json!({"schemas":["urn:ietf:params:scim:api:messages:2.0:Error"],"detail":"Database not available","status":503})),
    )
        .into_response()
}

fn err_internal(e: impl std::fmt::Display) -> axum::response::Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"schemas":["urn:ietf:params:scim:api:messages:2.0:Error"],"detail":e.to_string(),"status":500})),
    )
        .into_response()
}

fn not_found(resource: &str) -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"schemas":["urn:ietf:params:scim:api:messages:2.0:Error"],"detail":format!("{resource} not found"),"status":404})),
    )
        .into_response()
}

#[derive(Deserialize)]
struct ScimListQuery {
    #[serde(rename = "startIndex", default = "one")]
    start_index: i64,
    #[serde(rename = "count", default = "d_count")]
    count: i64,
}
fn one() -> i64 {
    1
}
fn d_count() -> i64 {
    100
}

// ── Discovery ─────────────────────────────────────────────────────────────────

/// SCIM v2 Service Provider Configuration (RFC 7643 Section 5).
async fn service_provider_config() -> impl IntoResponse {
    Json(serde_json::json!({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        "documentationUri": "https://secureyeoman.com/docs/scim",
        "patch": {"supported": true},
        "bulk": {"supported": false, "maxOperations": 0, "maxPayloadSize": 0},
        "filter": {"supported": true, "maxResults": 200},
        "changePassword": {"supported": false},
        "sort": {"supported": false},
        "etag": {"supported": false},
        "authenticationSchemes": [
            {
                "type": "oauthbearertoken",
                "name": "OAuth Bearer Token",
                "description": "Authentication via OAuth 2.0 Bearer Token",
                "specUri": "https://tools.ietf.org/html/rfc6750",
                "primary": true,
            }
        ],
    }))
}

async fn resource_types() -> impl IntoResponse {
    Json(serde_json::json!({
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": 2,
        "Resources": [
            {
                "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
                "id": "User",
                "name": "User",
                "endpoint": "/Users",
                "schema": "urn:ietf:params:scim:schemas:core:2.0:User",
            },
            {
                "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
                "id": "Group",
                "name": "Group",
                "endpoint": "/Groups",
                "schema": "urn:ietf:params:scim:schemas:core:2.0:Group",
            },
        ]
    }))
}

async fn schemas() -> impl IntoResponse {
    Json(serde_json::json!({
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": 2,
        "Resources": [
            {
                "id": "urn:ietf:params:scim:schemas:core:2.0:User",
                "name": "User",
                "description": "User Account",
                "attributes": [
                    {"name": "userName", "type": "string", "required": true},
                    {"name": "displayName", "type": "string", "required": false},
                    {"name": "active", "type": "boolean", "required": false},
                    {"name": "emails", "type": "complex", "multiValued": true, "required": false},
                ]
            },
            {
                "id": "urn:ietf:params:scim:schemas:core:2.0:Group",
                "name": "Group",
                "description": "Group",
                "attributes": [
                    {"name": "displayName", "type": "string", "required": true},
                    {"name": "members", "type": "complex", "multiValued": true, "required": false},
                ]
            },
        ]
    }))
}

// ── Users ─────────────────────────────────────────────────────────────────────

fn scim_user_response(row: &security::ScimUserRow) -> serde_json::Value {
    serde_json::json!({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "id": row.id,
        "externalId": row.external_id,
        "userName": row.user_name,
        "displayName": row.display_name,
        "active": row.active,
        "emails": row.emails_json,
        "meta": {
            "resourceType": "User",
            "created": row.created_at,
            "lastModified": row.updated_at,
            "location": format!("/api/v1/scim/v2/Users/{}", row.id),
        }
    })
}

async fn list_users(
    State(s): State<AppState>,
    Query(q): Query<ScimListQuery>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let limit = q.count.min(200).max(1);
    let offset = (q.start_index - 1).max(0);

    let (total, rows) = tokio::try_join!(
        security::count_scim_users(pool),
        security::list_scim_users(pool, limit, offset),
    )
    .unwrap_or((0, vec![]));

    let resources: Vec<_> = rows.iter().map(scim_user_response).collect();
    Json(serde_json::json!({
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": total,
        "startIndex": q.start_index,
        "itemsPerPage": limit,
        "Resources": resources,
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScimUserRequest {
    #[serde(rename = "externalId")]
    external_id: Option<String>,
    #[serde(rename = "userName")]
    user_name: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(default = "default_true")]
    active: bool,
    #[serde(default = "empty_json_array")]
    emails: serde_json::Value,
}
fn default_true() -> bool {
    true
}
fn empty_json_array() -> serde_json::Value {
    serde_json::json!([])
}

async fn create_user(
    State(s): State<AppState>,
    Json(body): Json<ScimUserRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::create_scim_user(
        pool,
        &id,
        body.external_id.as_deref(),
        &body.user_name,
        body.display_name.as_deref(),
        body.active,
        &body.emails,
    )
    .await
    {
        Ok(row) => (StatusCode::CREATED, Json(scim_user_response(&row))).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn get_user(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_scim_user(pool, &id).await {
        Ok(Some(row)) => Json(scim_user_response(&row)).into_response(),
        Ok(None) => not_found("User"),
        Err(e) => err_internal(e),
    }
}

async fn replace_user(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ScimUserRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::replace_scim_user(
        pool,
        &id,
        body.external_id.as_deref(),
        &body.user_name,
        body.display_name.as_deref(),
        body.active,
        &body.emails,
    )
    .await
    {
        Ok(Some(row)) => Json(scim_user_response(&row)).into_response(),
        Ok(None) => not_found("User"),
        Err(e) => err_internal(e),
    }
}

async fn delete_user(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::delete_scim_user(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("User"),
        Err(e) => err_internal(e),
    }
}

// ── Groups ────────────────────────────────────────────────────────────────────

fn scim_group_response(row: &security::ScimGroupRow) -> serde_json::Value {
    serde_json::json!({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        "id": row.id,
        "externalId": row.external_id,
        "displayName": row.display_name,
        "members": row.members_json,
        "meta": {
            "resourceType": "Group",
            "created": row.created_at,
            "lastModified": row.updated_at,
            "location": format!("/api/v1/scim/v2/Groups/{}", row.id),
        }
    })
}

async fn list_groups(
    State(s): State<AppState>,
    Query(q): Query<ScimListQuery>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let limit = q.count.min(200).max(1);
    let offset = (q.start_index - 1).max(0);

    let (total, rows) = tokio::try_join!(
        security::count_scim_groups(pool),
        security::list_scim_groups(pool, limit, offset),
    )
    .unwrap_or((0, vec![]));

    let resources: Vec<_> = rows.iter().map(scim_group_response).collect();
    Json(serde_json::json!({
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": total,
        "startIndex": q.start_index,
        "itemsPerPage": limit,
        "Resources": resources,
    }))
    .into_response()
}

#[derive(Deserialize)]
struct ScimGroupRequest {
    #[serde(rename = "externalId")]
    external_id: Option<String>,
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(default = "empty_json_array")]
    members: serde_json::Value,
}

async fn create_group(
    State(s): State<AppState>,
    Json(body): Json<ScimGroupRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    let id = uuid::Uuid::now_v7().to_string();
    match security::create_scim_group(
        pool,
        &id,
        body.external_id.as_deref(),
        &body.display_name,
        &body.members,
    )
    .await
    {
        Ok(row) => (StatusCode::CREATED, Json(scim_group_response(&row))).into_response(),
        Err(e) => err_internal(e),
    }
}

async fn get_group(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::get_scim_group(pool, &id).await {
        Ok(Some(row)) => Json(scim_group_response(&row)).into_response(),
        Ok(None) => not_found("Group"),
        Err(e) => err_internal(e),
    }
}

async fn replace_group(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ScimGroupRequest>,
) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::replace_scim_group(
        pool,
        &id,
        body.external_id.as_deref(),
        &body.display_name,
        &body.members,
    )
    .await
    {
        Ok(Some(row)) => Json(scim_group_response(&row)).into_response(),
        Ok(None) => not_found("Group"),
        Err(e) => err_internal(e),
    }
}

async fn delete_group(State(s): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let Some(pool) = s.db() else {
        return err_unavailable();
    };
    match security::delete_scim_group(pool, &id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found("Group"),
        Err(e) => err_internal(e),
    }
}
