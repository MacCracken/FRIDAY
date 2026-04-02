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

    let mut config = sy_types::CoreConfig::default();
    // Override from environment (matches docker-compose env vars)
    if let Ok(host) = std::env::var("SECUREYEOMAN_HOST") {
        config.host = host;
    }
    if let Ok(port) = std::env::var("SECUREYEOMAN_PORT") {
        if let Ok(p) = port.parse() {
            config.port = p;
        }
    } else if std::env::var("PORT").is_ok() {
        if let Ok(p) = std::env::var("PORT").unwrap().parse() {
            config.port = p;
        }
    }
    // Default to 18789 when running as the primary server (not dev mode)
    if config.port == 3001 {
        config.port = 18789;
    }
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
