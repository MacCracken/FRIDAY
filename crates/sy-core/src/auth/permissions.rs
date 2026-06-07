//! RBAC permission resolution — convention-based prefix→resource mapping.
//!
//! Mirrors `route-permissions.ts`: HTTP method → action, URL prefix → resource.
//! Explicit overrides for ~60 routes that deviate from convention.

use axum::http::Method;
use std::collections::HashMap;
use std::sync::LazyLock;

/// A resolved permission: (resource, action).
#[derive(Debug, Clone)]
pub struct ResolvedPermission {
    pub resource: &'static str,
    pub action: &'static str,
}

/// Convention-based URL prefix → resource mapping (ordered most-specific-first).
static PREFIX_MAP: LazyLock<Vec<(&str, &str)>> = LazyLock::new(|| {
    vec![
        ("/api/v1/auth/sso", "sso"),
        ("/api/v1/auth", "auth"),
        ("/api/v1/soul/personalities", "personality"),
        ("/api/v1/soul", "soul"),
        ("/api/v1/brain/documents", "documents"),
        ("/api/v1/brain", "brain"),
        ("/api/v1/spirit", "spirit"),
        ("/api/v1/chat", "chat"),
        ("/api/v1/tasks", "tasks"),
        ("/api/v1/integrations", "integrations"),
        ("/api/v1/agents", "agents"),
        ("/api/v1/swarms", "swarms"),
        ("/api/v1/teams", "teams"),
        ("/api/v1/councils", "councils"),
        ("/api/v1/workflows", "workflows"),
        ("/api/v1/a2a", "a2a"),
        ("/api/v1/training", "training"),
        ("/api/v1/mcp", "mcp"),
        ("/api/v1/audit", "audit"),
        ("/api/v1/alerts", "alerts"),
        ("/api/v1/telemetry", "telemetry"),
        ("/api/v1/analytics", "analytics"),
        ("/api/v1/notifications", "notifications"),
        ("/api/v1/security", "security"),
        ("/api/v1/risk-assessment", "risk-assessment"),
        ("/api/v1/desktop", "capture.screen"),
        ("/api/v1/video", "capture.video"),
        ("/api/v1/terminal", "execution"),
        ("/api/v1/execution", "execution"),
        ("/api/v1/browser", "execution"),
        ("/api/v1/sandbox", "sandbox"),
        ("/api/v1/marketplace", "marketplace"),
        ("/api/v1/extensions", "extensions"),
        ("/api/v1/proactive", "proactive"),
        ("/api/v1/edge", "edge"),
        ("/api/v1/federation", "federation"),
        ("/api/v1/tenants", "tenants"),
        ("/api/v1/license", "license"),
        ("/api/v1/backup", "backup"),
        ("/api/v1/ifran", "ifran"),
        ("/api/v1/provider-accounts", "providers"),
        ("/api/v1/models", "models"),
        ("/api/v1/conversations", "conversations"),
        ("/api/v1/gateway", "gateway"),
        ("/api/v1/dashboard", "dashboard"),
        ("/api/v1/workspace", "workspace"),
        ("/api/v1/voice", "voice"),
        ("/api/v1/multimodal", "multimodal"),
        ("/api/v1/diagnostics", "diagnostics"),
    ]
});

/// Explicit overrides for routes that deviate from convention.
/// Key: (method, path_pattern) → (resource, action).
type OverrideMap = HashMap<(&'static str, &'static str), (&'static str, &'static str)>;

static OVERRIDES: LazyLock<OverrideMap> = LazyLock::new(|| {
    let mut m = HashMap::new();
    m.insert(("POST", "/api/v1/audit/verify"), ("audit", "verify"));
    m.insert(("POST", "/api/v1/chat"), ("chat", "execute"));
    m.insert(("POST", "/api/v1/chat/stream"), ("chat", "execute"));
    m.insert(("POST", "/api/v1/execution/run"), ("execution", "execute"));
    m.insert(
        ("POST", "/api/v1/browser/sessions"),
        ("execution", "execute"),
    );
    m.insert(("POST", "/api/v1/sandbox/scan"), ("sandbox", "execute"));
    m
});

/// Resolve the permission required for a given request.
///
/// Returns `None` for unmapped routes (which should default to admin-only).
pub fn resolve_permission(method: &Method, path: &str) -> Option<ResolvedPermission> {
    // 1. Check explicit overrides
    let method_str = method.as_str();
    if let Some(&(resource, action)) = OVERRIDES.get(&(method_str, path)) {
        return Some(ResolvedPermission { resource, action });
    }

    // 2. Convention: method → action
    let action = match *method {
        Method::GET | Method::HEAD | Method::OPTIONS => "read",
        _ => "write",
    };

    // 3. Convention: URL prefix → resource (first match wins)
    for &(prefix, resource) in PREFIX_MAP.iter() {
        if path.starts_with(prefix) {
            return Some(ResolvedPermission { resource, action });
        }
    }

    None // Unmapped → admin only
}

/// Role definitions with their allowed permissions.
/// Each entry: (resource_pattern, actions).
pub fn role_permissions(role: &str) -> &'static [(&'static str, &'static [&'static str])] {
    match role {
        "admin" => &[("*", &["*"])],
        "operator" => &[
            ("chat", &["read", "write", "execute"]),
            ("brain", &["read", "write"]),
            ("soul", &["read", "write"]),
            ("spirit", &["read", "write"]),
            ("personality", &["read", "write"]),
            ("tasks", &["read", "write"]),
            ("integrations", &["read", "write"]),
            ("agents", &["read", "write"]),
            ("swarms", &["read", "write"]),
            ("teams", &["read", "write"]),
            ("workflows", &["read", "write"]),
            ("mcp", &["read", "write"]),
            ("execution", &["read", "execute"]),
            ("marketplace", &["read", "write"]),
            ("proactive", &["read", "write"]),
            ("conversations", &["read", "write"]),
            ("models", &["read"]),
            ("providers", &["read"]),
            ("documents", &["read", "write"]),
            ("voice", &["read", "write"]),
            ("multimodal", &["read", "write"]),
        ],
        "auditor" => &[
            ("audit", &["read"]),
            ("security", &["read"]),
            ("telemetry", &["read"]),
            ("analytics", &["read"]),
            ("risk-assessment", &["read"]),
        ],
        "viewer" => &[
            ("brain", &["read"]),
            ("soul", &["read"]),
            ("personality", &["read"]),
            ("tasks", &["read"]),
            ("integrations", &["read"]),
            ("conversations", &["read"]),
            ("models", &["read"]),
            ("dashboard", &["read"]),
        ],
        "service" => &[
            ("brain", &["read", "write"]),
            ("soul", &["read"]),
            ("mcp", &["read", "write"]),
            ("integrations", &["read"]),
        ],
        _ => &[],
    }
}

/// Whether a `resource` pattern (`*`, exact, or `prefix.*`) matches `resource`.
fn resource_matches(res_pattern: &str, resource: &str) -> bool {
    res_pattern == "*"
        || res_pattern == resource
        || (res_pattern.ends_with(".*")
            && resource.starts_with(&res_pattern[..res_pattern.len() - 2]))
}

/// Check if a role has a specific permission.
pub fn check_permission(role: &str, resource: &str, action: &str) -> bool {
    for &(res_pattern, actions) in role_permissions(role) {
        if resource_matches(res_pattern, resource)
            && (actions.contains(&"*") || actions.contains(&action))
        {
            return true;
        }
    }
    false
}

/// Check whether a set of principal permission strings grants `action` on
/// `resource`. Each string is `"resource:action1,action2"` (e.g. `"*:*"`,
/// `"*:read"`, `"brain:read,write"`, `"capture.*:read"`) — the same wildcard
/// semantics as role permissions. Used to let a token/API-key carry its own
/// least-privilege scope that further restricts (never expands) its role.
pub fn check_permission_strings(perms: &[String], resource: &str, action: &str) -> bool {
    for p in perms {
        let Some((res_pattern, actions_csv)) = p.split_once(':') else {
            continue;
        };
        if resource_matches(res_pattern.trim(), resource)
            && actions_csv
                .split(',')
                .map(str::trim)
                .any(|a| a == "*" || a == action)
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_has_everything() {
        assert!(check_permission("admin", "brain", "write"));
        assert!(check_permission("admin", "anything", "whatever"));
    }

    #[test]
    fn viewer_read_only() {
        assert!(check_permission("viewer", "brain", "read"));
        assert!(!check_permission("viewer", "brain", "write"));
        assert!(!check_permission("viewer", "chat", "execute"));
    }

    #[test]
    fn operator_can_execute_chat() {
        assert!(check_permission("operator", "chat", "execute"));
        assert!(check_permission("operator", "execution", "execute"));
    }

    #[test]
    fn auditor_read_only_security() {
        assert!(check_permission("auditor", "audit", "read"));
        assert!(!check_permission("auditor", "audit", "write"));
        assert!(!check_permission("auditor", "brain", "read"));
    }

    #[test]
    fn unknown_role_denied() {
        assert!(!check_permission("hacker", "brain", "read"));
    }

    #[test]
    fn resolve_convention_get() {
        let perm = resolve_permission(&Method::GET, "/api/v1/brain/memories").unwrap();
        assert_eq!(perm.resource, "brain");
        assert_eq!(perm.action, "read");
    }

    #[test]
    fn resolve_convention_post() {
        let perm = resolve_permission(&Method::POST, "/api/v1/integrations/slack").unwrap();
        assert_eq!(perm.resource, "integrations");
        assert_eq!(perm.action, "write");
    }

    #[test]
    fn resolve_override() {
        let perm = resolve_permission(&Method::POST, "/api/v1/chat").unwrap();
        assert_eq!(perm.resource, "chat");
        assert_eq!(perm.action, "execute");
    }

    #[test]
    fn resolve_unmapped() {
        let perm = resolve_permission(&Method::GET, "/api/v1/unknown/route");
        assert!(perm.is_none());
    }

    #[test]
    fn permission_strings_wildcards() {
        let all = vec!["*:*".to_string()];
        assert!(check_permission_strings(&all, "brain", "write"));
        assert!(check_permission_strings(&all, "anything", "whatever"));
    }

    #[test]
    fn permission_strings_scoped() {
        let scope = vec!["brain:read,write".to_string(), "chat:execute".to_string()];
        assert!(check_permission_strings(&scope, "brain", "read"));
        assert!(check_permission_strings(&scope, "brain", "write"));
        assert!(check_permission_strings(&scope, "chat", "execute"));
        // Outside the scope:
        assert!(!check_permission_strings(&scope, "brain", "execute"));
        assert!(!check_permission_strings(&scope, "audit", "read"));
    }

    #[test]
    fn permission_strings_action_and_resource_wildcards() {
        assert!(check_permission_strings(
            &["*:read".to_string()],
            "brain",
            "read"
        ));
        assert!(!check_permission_strings(
            &["*:read".to_string()],
            "brain",
            "write"
        ));
        assert!(check_permission_strings(
            &["capture.*:read".to_string()],
            "capture.screen",
            "read"
        ));
    }

    #[test]
    fn permission_strings_empty_denies() {
        assert!(!check_permission_strings(&[], "brain", "read"));
    }
}
