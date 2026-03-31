//! SCIM routes — SCIM v2 service provider configuration.
//!
//! No database needed — returns static SCIM discovery metadata.

use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/v1/scim/v2", get(service_provider_config))
}

/// SCIM v2 Service Provider Configuration (RFC 7643 Section 5).
async fn service_provider_config() -> impl IntoResponse {
    Json(serde_json::json!({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        "documentationUri": "https://secureyeoman.com/docs/scim",
        "patch": {"supported": false},
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
