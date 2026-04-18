//! System metrics collector — CPU, memory, disk usage, uptime.

use serde::Serialize;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::task::JoinHandle;

const SAMPLE_INTERVAL: Duration = Duration::from_secs(10);
const MAX_HISTORY: usize = 360; // 1 hour at 10s intervals

#[derive(Debug, Clone, Serialize)]
pub struct MetricsSample {
    pub cpu_percent: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub disk_used_percent: f32,
    pub uptime_seconds: u64,
    pub timestamp: String,
}

pub struct MetricsCollector {
    history: Arc<RwLock<Vec<MetricsSample>>>,
    started_at: Instant,
}

impl MetricsCollector {
    pub fn new() -> Self {
        Self {
            history: Arc::new(RwLock::new(Vec::with_capacity(MAX_HISTORY))),
            started_at: Instant::now(),
        }
    }

    pub fn start(&self) -> JoinHandle<()> {
        let history = self.history.clone();
        let started_at = self.started_at;

        tokio::spawn(async move {
            loop {
                let sample = collect_sample(started_at);
                {
                    let mut h = history.write().unwrap();
                    if h.len() >= MAX_HISTORY {
                        h.remove(0);
                    }
                    h.push(sample);
                }
                tokio::time::sleep(SAMPLE_INTERVAL).await;
            }
        })
    }

    pub fn current(&self) -> serde_json::Value {
        let sample = collect_sample(self.started_at);
        serde_json::to_value(sample).unwrap_or_default()
    }

    pub fn history(&self, minutes: u32) -> serde_json::Value {
        let h = self.history.read().unwrap();
        let samples_needed = (minutes as usize * 6).min(h.len()); // 6 samples per minute
        let start = h.len().saturating_sub(samples_needed);
        serde_json::to_value(&h[start..]).unwrap_or_default()
    }

    pub fn prometheus(&self) -> String {
        let sample = collect_sample(self.started_at);
        format!(
            "# HELP sy_edge_cpu_percent CPU usage percentage\n\
             # TYPE sy_edge_cpu_percent gauge\n\
             sy_edge_cpu_percent {:.1}\n\
             # HELP sy_edge_memory_used_mb Memory used in MB\n\
             # TYPE sy_edge_memory_used_mb gauge\n\
             sy_edge_memory_used_mb {}\n\
             # HELP sy_edge_memory_total_mb Total memory in MB\n\
             # TYPE sy_edge_memory_total_mb gauge\n\
             sy_edge_memory_total_mb {}\n\
             # HELP sy_edge_uptime_seconds Uptime in seconds\n\
             # TYPE sy_edge_uptime_seconds counter\n\
             sy_edge_uptime_seconds {}\n",
            sample.cpu_percent,
            sample.memory_used_mb,
            sample.memory_total_mb,
            sample.uptime_seconds,
        )
    }
}

fn collect_sample(started_at: Instant) -> MetricsSample {
    let sys = sysinfo::System::new_all();
    let total_mem = sys.total_memory() / (1024 * 1024);
    let used_mem = sys.used_memory() / (1024 * 1024);
    let cpu = sys.global_cpu_usage();

    // Disk usage
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let disk_percent = if let Some(d) = disks.list().first() {
        let total = d.total_space() as f64;
        if total > 0.0 {
            ((total - d.available_space() as f64) / total * 100.0) as f32
        } else {
            0.0
        }
    } else {
        0.0
    };

    MetricsSample {
        cpu_percent: cpu,
        memory_used_mb: used_mem,
        memory_total_mb: total_mem,
        disk_used_percent: disk_percent,
        uptime_seconds: started_at.elapsed().as_secs(),
        timestamp: chrono_now(),
    }
}

fn chrono_now() -> String {
    // Simple ISO 8601 without chrono dependency
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}Z", dur.as_secs())
}
