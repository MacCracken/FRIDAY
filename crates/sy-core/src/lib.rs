// Phase 7 migration: modules are scaffolded ahead of route migration.
// Suppress dead_code until routes consume the full auth/permissions API.
#![allow(dead_code)]

//! SecureYeoman Core Server — library crate for testing and embedding.

pub mod auth;
pub mod brain;
pub mod db;
pub mod ecosystem;
pub mod integrations;
pub mod middleware;
pub mod orchestration;
pub mod proxy;
pub mod routes;
pub mod server;
pub mod state;
