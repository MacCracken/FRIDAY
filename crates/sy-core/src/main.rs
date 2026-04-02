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
    let port_explicit = std::env::var("SECUREYEOMAN_PORT").ok().or_else(|| std::env::var("PORT").ok());
    if let Some(ref port_str) = port_explicit {
        if let Ok(p) = port_str.parse() {
            config.port = p;
        }
    }
    // Default to 18789 when no port explicitly set (default config is 3001)
    if port_explicit.is_none() && config.port == 3001 {
        config.port = 18789;
    }
    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;

    let mut app_state = state::AppState::new(config);

    // Connect to database — retry a few times for embedded PG startup
    let pool_result = {
        let mut result = db::pool::create_pool().await;
        for attempt in 1..=5 {
            if result.is_ok() { break; }
            info!("Database not ready, retrying ({attempt}/5)...");
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            result = db::pool::create_pool().await;
        }
        result
    };
    match pool_result {
        Ok(pool) => {
            info!("Connected to PostgreSQL");

            // Load persisted secrets from DB and set as env vars
            let secrets: Vec<(String, String)> = sqlx::query_as(
                "SELECT key, value FROM security.policy WHERE key LIKE 'secret:%'",
            )
            .fetch_all(&pool)
            .await
            .unwrap_or_default();

            for (key, value) in &secrets {
                if let Some(name) = key.strip_prefix("secret:") {
                    if !value.is_empty() {
                        // SAFETY: runs at startup before any concurrent env reads
                        unsafe { std::env::set_var(name, value) };
                        info!(secret = name, "loaded persisted secret");
                    }
                }
            }
            if !secrets.is_empty() {
                info!(count = secrets.len(), "persisted secrets loaded");
            }

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
