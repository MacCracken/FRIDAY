//! Tower middleware stack — mirrors the 16 Fastify hooks in order.
//!
//! During Phase 7.0, most layers are pass-through stubs. They will be
//! implemented in Phase 7.1 (auth/security).

pub mod backpressure;
pub mod body_limit;
pub mod correlation_id;
pub mod fingerprinting;
pub mod ip_reputation;
pub mod local_network;
pub mod rate_limit;
pub mod security_headers;
