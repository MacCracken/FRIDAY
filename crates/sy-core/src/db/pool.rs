//! PostgreSQL connection pool initialization.

use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

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

    PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await
        .map_err(|e| format!("Failed to connect to PostgreSQL: {e}"))
}

/// Create a pool from an explicit URL (for testing).
pub async fn create_pool_from_url(url: &str) -> Result<PgPool, String> {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(url)
        .await
        .map_err(|e| format!("Failed to connect to PostgreSQL: {e}"))
}
