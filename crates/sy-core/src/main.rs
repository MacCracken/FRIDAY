//! SecureYeoman Core Server — axum-based REST/WS API.

use std::net::SocketAddr;

use sy_core::db;
use sy_core::server;
use sy_core::state;
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

    // Load defaults → TOML file (if present) → env var overrides
    let config = sy_core::types::CoreConfig::load(None)?;
    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;

    // Refuse to boot an *exposed* server (non-loopback bind or remote access
    // enabled) without a strong JWT secret — a missing/weak/placeholder secret
    // would let anyone forge admin tokens. Loopback-only dev runs are allowed to
    // fall back to a random ephemeral secret (see AppState::new).
    let remote_access_enabled =
        std::env::var("SECUREYEOMAN_ALLOW_REMOTE_ACCESS").is_ok_and(|v| v == "true" || v == "1");
    let exposed = !addr.ip().is_loopback() || remote_access_enabled;
    if exposed {
        let strong = std::env::var("SECUREYEOMAN_JWT_SECRET")
            .ok()
            .is_some_and(|s| sy_core::state::is_strong_jwt_secret(&s));
        if !strong {
            return Err(format!(
                "refusing to start: SECUREYEOMAN_JWT_SECRET must be set to a strong value \
                 (at least 32 bytes and not the dev placeholder) when binding to {addr} or with \
                 SECUREYEOMAN_ALLOW_REMOTE_ACCESS enabled — otherwise admin tokens are forgeable"
            )
            .into());
        }
    }

    let db_url = config.database_url.clone();
    let mut app_state = state::AppState::new(config);

    // Connect to database — retry a few times for embedded PG startup
    let connect = || async {
        match db_url.as_deref() {
            Some(url) => db::pool::create_pool_from_url(url).await,
            None => db::pool::create_pool().await,
        }
    };
    let pool_result = {
        let mut result = connect().await;
        for attempt in 1..=5 {
            if result.is_ok() {
                break;
            }
            info!("Database not ready, retrying ({attempt}/5)...");
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            result = connect().await;
        }
        result
    };
    match pool_result {
        Ok(pool) => {
            info!("Connected to PostgreSQL");

            // Run migrations from /usr/local/bin/migrations/ if they exist
            let migrations_dir = std::path::Path::new("/usr/local/bin/migrations");
            if migrations_dir.exists() {
                let mut files: Vec<_> = std::fs::read_dir(migrations_dir)
                    .unwrap_or_else(|_| std::fs::read_dir(".").unwrap())
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("sql"))
                    .collect();
                files.sort_by_key(|e| e.file_name());

                for entry in &files {
                    let sql = std::fs::read_to_string(entry.path()).unwrap_or_default();
                    if sql.is_empty() {
                        continue;
                    }
                    match sqlx::raw_sql(&sql).execute(&pool).await {
                        Ok(_) => info!(file = ?entry.file_name(), "migration applied"),
                        Err(e) => {
                            // Ignore "already exists" errors (idempotent migrations)
                            let msg = e.to_string();
                            if !msg.contains("already exists") && !msg.contains("duplicate key") {
                                tracing::warn!(file = ?entry.file_name(), error = %e, "migration warning");
                            }
                        }
                    }
                }
            }

            // Seed default data if DB is empty (first boot)
            let personality_count: (i64,) =
                sqlx::query_as("SELECT count(*) FROM soul.personalities")
                    .fetch_one(&pool)
                    .await
                    .unwrap_or((0,));
            if personality_count.0 == 0 {
                info!("First boot — seeding default personalities and agents");
                crate::db::seed::seed_defaults(&pool).await;
            }

            // Load persisted secrets from DB and set as env vars
            let secrets: Vec<(String, String)> =
                sqlx::query_as("SELECT key, value FROM security.policy WHERE key LIKE 'secret:%'")
                    .fetch_all(&pool)
                    .await
                    .unwrap_or_default();

            for (key, value) in &secrets {
                if let Some(name) = key.strip_prefix("secret:")
                    && !value.is_empty()
                {
                    // SAFETY: runs at startup before any concurrent env reads
                    unsafe { std::env::set_var(name, value) };
                    info!(secret = name, "loaded persisted secret");
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
    // Serve with ConnectInfo so the real TCP peer address is available to the
    // client-IP helper. Without this, IP-based controls (local-network gate,
    // rate limit, IP reputation) would have no authoritative source and fall
    // back to the spoofable `X-Forwarded-For` header.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
