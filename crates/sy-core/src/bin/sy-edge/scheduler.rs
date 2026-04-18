//! Task scheduler — recurring command/webhook/LLM tasks.

use crate::{llm, messaging};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::task::JoinHandle;

const MIN_INTERVAL_SECS: u64 = 10;

fn random_hex_suffix() -> [u8; 8] {
    use rand::RngCore;
    let mut bytes = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: String,
    #[serde(rename = "type")]
    pub task_type: String, // "command", "webhook", "llm"
    pub config: serde_json::Value,
    pub interval_seconds: u64,
    #[serde(skip)]
    pub last_run: Option<Instant>,
    pub run_count: u64,
}

pub struct Scheduler {
    tasks: Arc<Mutex<HashMap<String, ScheduledTask>>>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start(&self, _llm: llm::LlmClient, _messenger: messaging::Messenger) -> JoinHandle<()> {
        let tasks = self.tasks.clone();

        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;

                let mut tasks_guard = tasks.lock().unwrap();
                let now = Instant::now();

                for task in tasks_guard.values_mut() {
                    let should_run = task.last_run.is_none_or(|last| {
                        now.duration_since(last).as_secs() >= task.interval_seconds
                    });

                    if should_run {
                        task.last_run = Some(now);
                        task.run_count += 1;
                        // TODO: actually execute task based on type
                        tracing::debug!(
                            task_id = %task.id,
                            task_type = %task.task_type,
                            run_count = task.run_count,
                            "Scheduled task triggered"
                        );
                    }
                }
            }
        })
    }

    pub fn add_task(&self, body: serde_json::Value) -> Result<String, String> {
        let task_type = body
            .get("type")
            .and_then(|v| v.as_str())
            .ok_or("Missing 'type' field")?
            .to_string();

        let interval = body
            .get("interval_seconds")
            .and_then(|v| v.as_u64())
            .unwrap_or(60);

        if interval < MIN_INTERVAL_SECS {
            return Err(format!("Interval too short (min {MIN_INTERVAL_SECS}s)"));
        }

        let id = format!(
            "task-{}",
            random_hex_suffix()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );

        let task = ScheduledTask {
            id: id.clone(),
            task_type,
            config: body.get("config").cloned().unwrap_or_default(),
            interval_seconds: interval,
            last_run: None,
            run_count: 0,
        };

        self.tasks.lock().unwrap().insert(id.clone(), task);
        Ok(id)
    }

    pub fn remove_task(&self, id: &str) {
        self.tasks.lock().unwrap().remove(id);
    }

    #[allow(dead_code)]
    pub fn task_count(&self) -> usize {
        self.tasks.lock().unwrap().len()
    }

    pub fn list_tasks(&self) -> Vec<serde_json::Value> {
        let tasks = self.tasks.lock().unwrap();
        tasks
            .values()
            .map(|t| {
                serde_json::json!({
                    "id": t.id,
                    "type": t.task_type,
                    "interval_seconds": t.interval_seconds,
                    "run_count": t.run_count,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_and_list_task() {
        let sched = Scheduler::new();
        let body = serde_json::json!({
            "type": "command",
            "interval_seconds": 60,
            "config": {"command": "uptime"}
        });
        let id = sched.add_task(body).unwrap();
        assert!(id.starts_with("task-"));

        let tasks = sched.list_tasks();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["type"], "command");
        assert_eq!(tasks[0]["interval_seconds"], 60);
    }

    #[test]
    fn add_task_missing_type() {
        let sched = Scheduler::new();
        let body = serde_json::json!({"interval_seconds": 60});
        let result = sched.add_task(body);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("type"));
    }

    #[test]
    fn add_task_interval_too_short() {
        let sched = Scheduler::new();
        let body = serde_json::json!({"type": "webhook", "interval_seconds": 5});
        let result = sched.add_task(body);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too short"));
    }

    #[test]
    fn remove_task() {
        let sched = Scheduler::new();
        let body = serde_json::json!({"type": "llm", "interval_seconds": 60});
        let id = sched.add_task(body).unwrap();
        assert_eq!(sched.task_count(), 1);

        sched.remove_task(&id);
        assert_eq!(sched.task_count(), 0);
    }

    #[test]
    fn remove_nonexistent_task() {
        let sched = Scheduler::new();
        sched.remove_task("task-nonexistent"); // should not panic
    }

    #[test]
    fn default_interval() {
        let sched = Scheduler::new();
        let body = serde_json::json!({"type": "command"});
        let _id = sched.add_task(body).unwrap();
        let tasks = sched.list_tasks();
        assert_eq!(tasks[0]["interval_seconds"], 60); // default
    }

    #[test]
    fn task_ids_unique() {
        let sched = Scheduler::new();
        let id1 = sched
            .add_task(serde_json::json!({"type": "a", "interval_seconds": 60}))
            .unwrap();
        let id2 = sched
            .add_task(serde_json::json!({"type": "b", "interval_seconds": 60}))
            .unwrap();
        assert_ne!(id1, id2);
    }
}
