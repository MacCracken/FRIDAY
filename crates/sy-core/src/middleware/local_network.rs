//! Local network check middleware — rejects requests from non-private IPs.
//!
//! When `SECUREYEOMAN_ALLOW_REMOTE_ACCESS=true` is set, this check is bypassed.
//! Otherwise, only RFC 1918 private addresses, loopback, and link-local are allowed.
//! Returns 403 for non-local IPs.

use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, Response};
use axum::middleware::Next;
use axum::response::IntoResponse;
use serde_json::json;
use std::net::IpAddr;

use crate::state::AppState;

/// Middleware that restricts access to local/private network IPs.
pub async fn check_local_network(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Response<Body> {
    if state.allow_remote_access() {
        return next.run(req).await;
    }

    let ip = crate::middleware::client_ip::client_ip(&req, state.trust_proxy_headers());

    if !is_private_ip(&ip) {
        return (
            axum::http::StatusCode::FORBIDDEN,
            axum::Json(json!({
                "error": "Dashboard is only accessible from local network",
                "statusCode": 403,
            })),
        )
            .into_response();
    }

    next.run(req).await
}

/// Check if an IP address is in a private/local range.
pub fn is_private_ip(ip: &str) -> bool {
    // Strip IPv6 mapped prefix
    let ip_str = ip.strip_prefix("::ffff:").unwrap_or(ip);

    let addr: IpAddr = match ip_str.parse() {
        Ok(a) => a,
        Err(_) => return false, // Unparseable IP treated as non-private
    };

    match addr {
        IpAddr::V4(v4) => {
            v4.is_loopback() // 127.0.0.0/8
                || v4.is_private() // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
                || v4.is_link_local() // 169.254.0.0/16
                || v4.is_unspecified() // 0.0.0.0
        }
        IpAddr::V6(v6) => {
            v6.is_loopback() // ::1
                || v6.is_unspecified() // ::
                || (v6.segments()[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_is_private() {
        assert!(is_private_ip("127.0.0.1"));
        assert!(is_private_ip("::1"));
    }

    #[test]
    fn rfc1918_is_private() {
        assert!(is_private_ip("10.0.0.1"));
        assert!(is_private_ip("10.255.255.255"));
        assert!(is_private_ip("172.16.0.1"));
        assert!(is_private_ip("172.31.255.255"));
        assert!(is_private_ip("192.168.0.1"));
        assert!(is_private_ip("192.168.1.100"));
    }

    #[test]
    fn docker_bridge_is_private() {
        assert!(is_private_ip("172.17.0.2"));
        assert!(is_private_ip("172.18.0.1"));
    }

    #[test]
    fn public_ips_are_not_private() {
        assert!(!is_private_ip("8.8.8.8"));
        assert!(!is_private_ip("1.1.1.1"));
        assert!(!is_private_ip("203.0.113.1"));
    }

    #[test]
    fn ipv6_mapped_v4_handled() {
        assert!(is_private_ip("::ffff:127.0.0.1"));
        assert!(is_private_ip("::ffff:10.0.0.1"));
        assert!(!is_private_ip("::ffff:8.8.8.8"));
    }

    #[test]
    fn link_local_is_private() {
        assert!(is_private_ip("169.254.1.1"));
        assert!(is_private_ip("fe80::1"));
    }

    #[test]
    fn unknown_treated_as_not_private() {
        assert!(!is_private_ip("unknown"));
        assert!(!is_private_ip(""));
        assert!(!is_private_ip("not-an-ip"));
    }
}
