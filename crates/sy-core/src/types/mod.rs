//! SecureYeoman shared types — Rust counterpart of `@secureyeoman/shared`.
//!
//! These types define the API contract between sy-core (Rust) and the
//! dashboard/MCP clients (TypeScript). All types implement Serialize +
//! Deserialize with camelCase field names to match the existing JSON wire format.

pub mod api;
pub mod auth;
pub mod config;
pub mod memory;

pub use api::{ApiError, HealthResponse, PaginatedResponse};
pub use auth::{AuthUser, Permission};
pub use config::CoreConfig;
