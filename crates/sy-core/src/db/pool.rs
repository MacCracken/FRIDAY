//! PostgreSQL connection pool initialization.

use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

/// Create a PostgreSQL connection pool from DATABASE_URL.
pub async fn create_pool() -> Result<PgPool, String> {
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| "DATABASE_URL environment variable not set".to_string())?;

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
