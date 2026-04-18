//! SecureYeoman Edge Runtime — standalone binary for IoT/edge devices.
//!
//! Replaces the Go edge binary with a smaller, lower-RSS Rust implementation.
//! Reuses sy-crypto and sy-hwprobe workspace crates.

mod a2a;
mod capabilities;
mod certpin;
mod llm;
mod mdns;
mod memory;
mod messaging;
mod metrics;
mod ratelimit;
mod sandbox;
mod scheduler;
mod server;
mod updater;

use clap::{Parser, Subcommand};
use tracing::{info, warn};

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Parser)]
#[command(name = "sy-edge", version = VERSION, about = "SecureYeoman Edge Runtime")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the edge runtime
    Start {
        /// HTTP port (default: 18891)
        #[arg(short, long, default_value_t = 18891)]
        port: u16,

        /// Bind address
        #[arg(short = 'H', long, default_value = "0.0.0.0")]
        host: String,

        /// Log level (debug, info, warn, error)
        #[arg(short, long, default_value = "info")]
        log_level: String,

        /// Parent SY instance URL for auto-registration
        #[arg(long)]
        parent: Option<String>,
    },

    /// Register with a parent SecureYeoman instance
    Register {
        /// Parent instance URL
        #[arg(long)]
        parent: String,

        /// Registration token
        #[arg(long)]
        token: Option<String>,
    },

    /// Display node capabilities
    Status,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Start {
            port,
            host,
            log_level,
            parent,
        }) => {
            init_tracing(&log_level);
            run_start(port, host, parent).await;
        }
        Some(Commands::Register { parent, token }) => {
            init_tracing("info");
            run_register(&parent, token.as_deref()).await;
        }
        Some(Commands::Status) => {
            run_status();
        }
        None => {
            // Default: start with env-based config
            let port = std::env::var("SECUREYEOMAN_EDGE_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(18891);
            let host =
                std::env::var("SECUREYEOMAN_EDGE_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
            let parent = std::env::var("SECUREYEOMAN_PARENT_URL").ok();
            let log_level =
                std::env::var("SECUREYEOMAN_EDGE_LOG_LEVEL").unwrap_or_else(|_| "info".to_string());

            init_tracing(&log_level);
            run_start(port, host, parent).await;
        }
    }
}

fn init_tracing(level: &str) {
    use tracing_subscriber::{EnvFilter, fmt};

    let filter = EnvFilter::try_new(level).unwrap_or_else(|_| EnvFilter::new("info"));

    fmt()
        .with_env_filter(filter)
        .json()
        .with_target(false)
        .init();
}

async fn run_start(port: u16, host: String, parent_url: Option<String>) {
    info!(version = VERSION, port, host = %host, "SecureYeoman Edge starting");

    let caps = capabilities::detect();
    info!(
        node_id = %caps.node_id,
        hostname = %caps.hostname,
        arch = %caps.arch,
        memory_mb = caps.total_memory_mb,
        cpu_cores = caps.cpu_cores,
        has_gpu = caps.has_gpu,
        has_tpu = caps.has_tpu,
        "Capabilities detected"
    );

    // Initialize subsystems
    let metrics_collector = metrics::MetricsCollector::new();
    let memory_store = memory::MemoryStore::new();
    let sandbox_mgr = sandbox::SandboxManager::new();
    let llm_client = llm::LlmClient::from_env();
    let messenger = messaging::Messenger::from_env();
    let scheduler = scheduler::Scheduler::new();
    let a2a_manager = a2a::A2AManager::new(caps.clone());
    let rate_limiter = ratelimit::RateLimiter::new(100.0, 200);

    // Start background tasks
    let metrics_handle = metrics_collector.start();
    let scheduler_handle = scheduler.start(llm_client.clone(), messenger.clone());

    // Register with parent if configured
    let parent = parent_url.or_else(|| std::env::var("SECUREYEOMAN_PARENT_URL").ok());
    if let Some(ref url) = parent {
        let token = std::env::var("SECUREYEOMAN_EDGE_TOKEN").ok();
        match a2a_manager
            .register_with_parent(url, token.as_deref())
            .await
        {
            Ok(peer_id) => info!(parent_url = %url, peer_id, "Registered with parent"),
            Err(e) => warn!(parent_url = %url, error = %e, "Failed to register with parent"),
        }

        // Start mDNS advertising
        mdns::advertise(&caps, port);

        // Start cert pinning
        certpin::init_pin(url);

        // Start update loop
        let update_url = url.clone();
        let update_arch = caps.arch.clone();
        tokio::spawn(async move {
            updater::update_loop(&update_url, &update_arch).await;
        });
    }

    // Build and run HTTP server
    let state = server::AppState {
        capabilities: caps,
        metrics: metrics_collector,
        memory: memory_store,
        sandbox: sandbox_mgr,
        llm: llm_client,
        messenger,
        scheduler,
        a2a: a2a_manager,
        rate_limiter,
    };

    let app = server::build_router(state);

    let addr = format!("{host}:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| {
            tracing::error!(addr = %addr, error = %e, "Failed to bind");
            std::process::exit(1);
        });

    info!(addr = %addr, "SecureYeoman Edge ready");

    // Graceful shutdown on SIGINT/SIGTERM
    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
        info!("Shutdown signal received");
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .unwrap_or_else(|e| {
            tracing::error!(error = %e, "Server error");
        });

    // Cleanup
    metrics_handle.abort();
    scheduler_handle.abort();
    info!("SecureYeoman Edge shutdown complete");
}

async fn run_register(parent_url: &str, token: Option<&str>) {
    let caps = capabilities::detect();
    let a2a = a2a::A2AManager::new(caps);

    match a2a.register_with_parent(parent_url, token).await {
        Ok(peer_id) => {
            info!(parent_url, peer_id, "Registration successful");
            println!("Registered with {parent_url} as peer {peer_id}");
        }
        Err(e) => {
            tracing::error!(parent_url, error = %e, "Registration failed");
            std::process::exit(1);
        }
    }
}

fn run_status() {
    let caps = capabilities::detect();
    println!("{}", serde_json::to_string_pretty(&caps).unwrap());
}
