// Phase 7 migration: modules are scaffolded ahead of route migration.
// Suppress dead_code until routes consume the full auth/permissions API.
#![allow(dead_code)]

//! SecureYeoman Core Server — axum-based REST/WS API.
//!
//! Phase 7 migration: replaces the Bun/Fastify TypeScript server with a Rust
//! binary. During migration, unimplemented routes are forwarded to the existing
//! Fastify server via a built-in reverse proxy.

mod auth;
mod brain;
mod db;
mod ecosystem;
mod integrations;
mod middleware;
mod orchestration;
mod proxy;
mod routes;
mod server;
mod state;

use std::net::SocketAddr;
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sy_core=info,tower_http=info".into()),
        )
        .with_target(false)
        .init();

    let config = sy_types::CoreConfig::default();
    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;

    let mut app_state = state::AppState::new(config);

    // Connect to database if DATABASE_URL is set
    match db::pool::create_pool().await {
        Ok(pool) => {
            info!("Connected to PostgreSQL");
            app_state = app_state.with_db(pool);
        }
        Err(e) => {
            info!("No database connection: {e} — brain/soul routes will return 503");
        }
    }

    let app = server::build_router(app_state);

    info!("sy-core listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
