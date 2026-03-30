//! Route handlers — organized by domain.
//!
//! Each domain module (auth, brain, soul, etc.) will get its own submodule
//! as routes are migrated from TypeScript.

pub mod a2a;
pub mod agents;
pub mod alerts;
pub mod analytics;
pub mod audit;
pub mod auth;
pub mod backup;
pub mod brain;
pub mod chat;
pub mod edge;
pub mod event_bridge;
pub mod execution;
pub mod experiments;
pub mod extensions;
pub mod federation;
pub mod gateway;
pub mod health;
pub mod integrations;
pub mod marketplace;
pub mod mcp;
pub mod notifications;
pub mod proactive;
pub mod risk;
pub mod security;
pub mod soul;
pub mod spirit;
pub mod tasks;
pub mod tenants;
pub mod training;
pub mod workflow;
pub mod workspace;
