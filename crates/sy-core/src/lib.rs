// Suppress dead_code until routes consume the full auth/permissions API.
#![allow(dead_code)]

//! SecureYeoman Core Server — library crate for testing and embedding.

pub mod audit;
pub mod auth;
pub mod brain;
pub mod crypto;
pub mod db;
pub mod ecosystem;
pub mod hwprobe;
pub mod integrations;
pub mod middleware;
pub mod orchestration;
pub mod privacy;
pub mod routes;
pub mod sandbox;
pub mod server;
pub mod state;
pub mod tee;
pub mod types;
