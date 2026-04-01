//! Brain module — memory, knowledge, RAG pipeline, and vector search.
//!
//! Orchestrates the cognitive stack:
//! - **chunker** — sentence-aware overlapping text chunking
//! - **activation** — ACT-R base-level activation scoring
//! - **embedding** — provider-agnostic embedding trait
//! - **vector** — provider-agnostic vector store trait
//! - **manager** — BrainManager orchestrator (remember/recall/learn/context)

pub mod activation;
pub mod chunker;
pub mod embedding;
pub mod manager;
pub mod vector;
