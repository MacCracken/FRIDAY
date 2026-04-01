//! Orchestration module — workflow engine, swarm/council/team execution.
//!
//! Provides the multi-agent coordination layer:
//! - **workflow** — DAG execution with 28 step types, topological scheduling
//! - **swarm** — Multi-agent swarm (sequential/parallel/dynamic strategies)
//! - **council** — Multi-round deliberation with voting strategies
//! - **team** — LLM-directed dynamic agent assignment
//! - **delegation** — Shared agent delegation trait

pub mod council;
pub mod delegation;
pub mod hoosh;
pub mod swarm;
pub mod team;
pub mod workflow;
