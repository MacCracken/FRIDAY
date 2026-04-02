//! Ecosystem crate integrations — direct Rust calls replacing the NAPI bridge.
//!
//! Previously these crates were accessed via sy-napi → Node.js NAPI boundary.
//! Now they're called directly from sy-core with zero serialization overhead.
//!
//! - **bhava** — personality engine (already wired via brain module + bhava 2.0 signal loop)
//! - **szal** — workflow DAG validation, condition evaluation, template resolution
//! - **bote** — MCP tool registry, JSON-RPC protocol
//! - **dhvani** — voice synthesis, G2P, audio DSP
//! - **agnosai** — crew orchestration, model routing
//! - **majra** — pub/sub, rate limiting, heartbeat, barriers, queues

pub mod personality;
pub mod tools;
pub mod voice;
pub mod workflow_primitives;
