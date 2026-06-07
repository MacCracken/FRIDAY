//! PostgreSQL connection pool initialization.

use std::time::Duration;

use sqlx::Executor;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

/// Shared pool options: bounded connection lifecycle + a server-side statement
/// timeout. Without these, a stuck query holds a connection (and a worker)
/// indefinitely and `acquire()` can block forever under contention.
fn pool_options(max_connections: u32) -> PgPoolOptions {
    PgPoolOptions::new()
        .max_connections(max_connections)
        // Fail fast instead of blocking forever when the pool is exhausted.
        .acquire_timeout(Duration::from_secs(10))
        // Recycle idle / long-lived connections.
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                // Cap any single statement server-side so a runaway query can't
                // pin a connection (and the request handler) indefinitely.
                conn.execute("SET statement_timeout = '30s'").await?;
                Ok(())
            })
        })
}

/// Create a PostgreSQL connection pool.
///
/// Reads `DATABASE_URL` first. If not set, composes from individual env vars:
/// `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_NAME`, `POSTGRES_PASSWORD`.
pub async fn create_pool() -> Result<PgPool, String> {
    let database_url = if let Ok(url) = std::env::var("DATABASE_URL") {
        url
    } else {
        // Compose from individual vars (matches docker entrypoint)
        let host = std::env::var("DATABASE_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let port = std::env::var("DATABASE_PORT").unwrap_or_else(|_| "5432".to_string());
        let user = std::env::var("DATABASE_USER").unwrap_or_else(|_| "secureyeoman".to_string());
        let name = std::env::var("DATABASE_NAME").unwrap_or_else(|_| "secureyeoman".to_string());
        let password = std::env::var("POSTGRES_PASSWORD")
            .map_err(|_| "DATABASE_URL environment variable not set".to_string())?;
        format!("postgresql://{user}:{password}@{host}:{port}/{name}")
    };

    pool_options(20)
        .connect(&database_url)
        .await
        .map_err(|e| format!("Failed to connect to PostgreSQL: {e}"))
}

/// Create a pool from an explicit URL (for testing).
pub async fn create_pool_from_url(url: &str) -> Result<PgPool, String> {
    pool_options(5)
        .connect(url)
        .await
        .map_err(|e| format!("Failed to connect to PostgreSQL: {e}"))
}
