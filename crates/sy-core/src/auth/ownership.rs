//! Ownership guards — prevent users from accessing resources they don't own.
//!
//! Admin, operator, and service roles bypass ownership checks.
//! Viewer and auditor roles must own the resource (matching user_id).
//! Resources with no owner (owner_id returns None) are treated as shared/system resources.
//!
//! Current limitation: Most DB models lack a `created_by` column, so `OwnedResource`
//! implementations return `None` for existing rows. Full enforcement requires a DB
//! migration to add `created_by` and populate on insert.

use axum::body::Body;
use axum::http::{Response, StatusCode};
use axum::response::IntoResponse;
use serde_json::json;

use super::middleware::AuthContext;

/// Trait for resources that have an owner.
pub trait OwnedResource {
    /// The user ID of the resource owner. `None` means shared/system resource.
    fn owner_id(&self) -> Option<&str>;
}

/// Roles that bypass ownership checks entirely.
const BYPASS_ROLES: &[&str] = &["admin", "operator", "service"];

/// Check if the authenticated user can access a resource.
///
/// Returns true if:
/// - The user's role is in BYPASS_ROLES (admin, operator, service)
/// - The resource has no owner (shared/system resource)
/// - The resource's owner_id matches the user's user_id
pub fn can_access_resource(auth: &AuthContext, resource: &impl OwnedResource) -> bool {
    if BYPASS_ROLES.contains(&auth.role.as_str()) {
        return true;
    }

    match resource.owner_id() {
        None => true, // shared/system resource — accessible by all authenticated users
        Some(owner) => owner == auth.user_id,
    }
}

/// Build a 403 response for ownership violations.
pub fn forbidden_not_owner() -> Response<Body> {
    (
        StatusCode::FORBIDDEN,
        axum::Json(json!({
            "error": "You do not have access to this resource",
            "statusCode": 403,
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::middleware::AuthMethod;

    fn auth_ctx(user_id: &str, role: &str) -> AuthContext {
        AuthContext {
            user_id: user_id.to_string(),
            role: role.to_string(),
            permissions: vec![],
            auth_method: AuthMethod::Jwt,
            jti: None,
        }
    }

    struct TestResource {
        owner: Option<String>,
    }

    impl OwnedResource for TestResource {
        fn owner_id(&self) -> Option<&str> {
            self.owner.as_deref()
        }
    }

    #[test]
    fn admin_bypasses_ownership() {
        let auth = auth_ctx("user-1", "admin");
        let resource = TestResource {
            owner: Some("user-2".to_string()),
        };
        assert!(can_access_resource(&auth, &resource));
    }

    #[test]
    fn operator_bypasses_ownership() {
        let auth = auth_ctx("user-1", "operator");
        let resource = TestResource {
            owner: Some("user-2".to_string()),
        };
        assert!(can_access_resource(&auth, &resource));
    }

    #[test]
    fn service_bypasses_ownership() {
        let auth = auth_ctx("user-1", "service");
        let resource = TestResource {
            owner: Some("user-2".to_string()),
        };
        assert!(can_access_resource(&auth, &resource));
    }

    #[test]
    fn viewer_can_access_own_resource() {
        let auth = auth_ctx("user-1", "viewer");
        let resource = TestResource {
            owner: Some("user-1".to_string()),
        };
        assert!(can_access_resource(&auth, &resource));
    }

    #[test]
    fn viewer_cannot_access_other_resource() {
        let auth = auth_ctx("user-1", "viewer");
        let resource = TestResource {
            owner: Some("user-2".to_string()),
        };
        assert!(!can_access_resource(&auth, &resource));
    }

    #[test]
    fn auditor_cannot_access_other_resource() {
        let auth = auth_ctx("user-1", "auditor");
        let resource = TestResource {
            owner: Some("user-2".to_string()),
        };
        assert!(!can_access_resource(&auth, &resource));
    }

    #[test]
    fn shared_resource_accessible_by_all() {
        let auth = auth_ctx("user-1", "viewer");
        let resource = TestResource { owner: None };
        assert!(can_access_resource(&auth, &resource));
    }
}
