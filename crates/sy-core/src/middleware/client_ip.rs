//! Centralized, spoofing-resistant client-IP extraction.
//!
//! `X-Forwarded-For` is attacker-controlled: any client can send an arbitrary
//! value. It is therefore honored **only** when `trust_proxy` is true — i.e. the
//! deployment is explicitly configured (`SECUREYEOMAN_TRUST_PROXY_HEADERS=true`)
//! to sit behind a trusted reverse proxy that overwrites the header with the real
//! peer. In the default configuration the authoritative source is the real socket
//! peer from `ConnectInfo` (populated by serving with
//! `into_make_service_with_connect_info`).
//!
//! Using this for the local-network gate, rate limiter, IP-reputation blocker and
//! fingerprinter prevents trivial bypass via a forged `X-Forwarded-For: 127.0.0.1`
//! and per-IP rate-limit/ban evasion via spoofed addresses.

use axum::extract::ConnectInfo;
use axum::http::Request;
use std::net::SocketAddr;

/// Resolve the client IP for a request.
///
/// When `trust_proxy` is true, the first `X-Forwarded-For` hop is used (the proxy
/// is responsible for setting it to the genuine client). Otherwise the real TCP
/// peer is used. Falls back to `"unknown"` when neither is available (e.g. in
/// unit tests that drive the router with `oneshot` and no `ConnectInfo`).
pub fn client_ip<B>(req: &Request<B>, trust_proxy: bool) -> String {
    if trust_proxy
        && let Some(forwarded) = req.headers().get("x-forwarded-for")
        && let Ok(val) = forwarded.to_str()
        && let Some(first) = val.split(',').next()
    {
        let trimmed = first.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    if let Some(ConnectInfo(addr)) = req.extensions().get::<ConnectInfo<SocketAddr>>() {
        return addr.ip().to_string();
    }

    "unknown".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;

    fn req_with_xff(xff: &str) -> Request<Body> {
        Request::get("/")
            .header("x-forwarded-for", xff)
            .body(Body::empty())
            .unwrap()
    }

    #[test]
    fn ignores_xff_when_proxy_not_trusted() {
        // Default posture: a forged header must NOT be honored.
        let req = req_with_xff("127.0.0.1");
        assert_eq!(client_ip(&req, false), "unknown");
    }

    #[test]
    fn honors_first_xff_when_proxy_trusted() {
        let req = req_with_xff("203.0.113.7, 10.0.0.1");
        assert_eq!(client_ip(&req, true), "203.0.113.7");
    }

    #[test]
    fn falls_back_to_unknown_without_connectinfo() {
        let req = Request::get("/").body(Body::empty()).unwrap();
        assert_eq!(client_ip(&req, true), "unknown");
        assert_eq!(client_ip(&req, false), "unknown");
    }

    #[test]
    fn uses_connectinfo_peer_when_not_trusting_proxy() {
        let mut req = req_with_xff("9.9.9.9");
        let peer: SocketAddr = "192.168.1.50:4444".parse().unwrap();
        req.extensions_mut().insert(ConnectInfo(peer));
        // Forged XFF ignored; real peer wins.
        assert_eq!(client_ip(&req, false), "192.168.1.50");
        // When trusting the proxy, the XFF hop is used instead.
        assert_eq!(client_ip(&req, true), "9.9.9.9");
    }
}
