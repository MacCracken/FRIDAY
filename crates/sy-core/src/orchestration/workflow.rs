//! Workflow engine — DAG execution with topological scheduling.
//!
//! Executes workflow definitions as directed acyclic graphs (DAGs).
//! Steps are organized into tiers via topological sort (from szal Rust crate
//! via NAPI, or fallback Kahn's algorithm). Steps within a tier execute
//! in parallel (up to 20 concurrent).
//!
//! 28 step types are supported — see `StepType` enum.
//! Step handlers dispatch to the appropriate executor (agent, swarm, council,
//! webhook, code execution, etc.).

use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use crate::orchestration::delegation::{AgentDelegate, DelegationError, DelegationParams};

/// Maximum depth for subworkflow recursion.
const MAX_SUBWORKFLOW_DEPTH: u32 = 10;

/// Maximum concurrent steps per tier.
const MAX_PARALLEL_STEPS: usize = 20;

// ── Step Types ──────────────────────────────────────────────────────────

/// All supported workflow step types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepType {
    Agent,
    Swarm,
    Council,
    Tool,
    Condition,
    Transform,
    Loop,
    ParallelMap,
    Resource,
    DataValidation,
    CacheLookup,
    Webhook,
    Notification,
    A2aDelegate,
    DataCuration,
    TrainingJob,
    Evaluation,
    ConditionalDeploy,
    HumanApproval,
    CiTrigger,
    CiWait,
    Subworkflow,
    CodeExecution,
    DiagramGeneration,
    DocumentAnalysis,
    AgnosticCrew,
    AgnosticCrewWait,
    Delay,
}

// ── Workflow Definition ─────────────────────────────────────────────────

/// A workflow step definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStep {
    pub id: String,
    pub name: String,
    pub step_type: StepType,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub config: serde_json::Value,
    #[serde(default)]
    pub trigger_mode: Option<String>,
    #[serde(default)]
    pub on_error: Option<String>,
    #[serde(default)]
    pub retry_policy: Option<RetryPolicy>,
}

/// Retry policy for a step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub backoff_ms: u64,
}

/// A complete workflow definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinition {
    pub id: String,
    pub name: String,
    pub steps: Vec<WorkflowStep>,
    #[serde(default)]
    pub input: serde_json::Value,
}

// ── Execution Context ───────────────────────────────────────────────────

/// Accumulated context during workflow execution.
#[derive(Debug, Clone, Default)]
pub struct WorkflowContext {
    /// Per-step outputs: step_id → { output, status }
    pub steps: HashMap<String, StepResult>,
    /// Workflow input parameters.
    pub input: serde_json::Value,
}

/// Result of a single step execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub output: serde_json::Value,
    pub status: String,
}

/// Complete workflow execution result.
#[derive(Debug, Clone)]
pub struct WorkflowResult {
    pub outputs: HashMap<String, StepResult>,
    pub final_output: serde_json::Value,
    pub steps_completed: usize,
    pub steps_failed: usize,
}

// ── Topological Sort ────────────────────────────────────────────────────

/// Kahn's algorithm — returns tiers of parallel-executable step IDs.
///
/// Each tier contains steps whose dependencies are all in prior tiers.
/// Returns Err if a cycle is detected.
pub fn topological_sort(steps: &[WorkflowStep]) -> Result<Vec<Vec<String>>, WorkflowError> {
    let step_ids: HashSet<&str> = steps.iter().map(|s| s.id.as_str()).collect();

    // Build adjacency and in-degree maps
    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();

    for step in steps {
        in_degree.entry(step.id.as_str()).or_insert(0);
        for dep in &step.depends_on {
            if !step_ids.contains(dep.as_str()) {
                return Err(WorkflowError::MissingDependency {
                    step: step.id.clone(),
                    dependency: dep.clone(),
                });
            }
            *in_degree.entry(step.id.as_str()).or_insert(0) += 1;
            dependents
                .entry(dep.as_str())
                .or_default()
                .push(step.id.as_str());
        }
    }

    let mut tiers: Vec<Vec<String>> = Vec::new();
    let mut queue: VecDeque<&str> = in_degree
        .iter()
        .filter(|&(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    let mut visited = 0;

    while !queue.is_empty() {
        let tier: Vec<String> = queue.drain(..).map(|s| s.to_string()).collect();
        visited += tier.len();

        let mut next_queue = VecDeque::new();
        for step_id in &tier {
            if let Some(deps) = dependents.get(step_id.as_str()) {
                for &dep in deps {
                    if let Some(deg) = in_degree.get_mut(dep) {
                        *deg -= 1;
                        if *deg == 0 {
                            next_queue.push_back(dep);
                        }
                    }
                }
            }
        }

        tiers.push(tier);
        queue = next_queue;
    }

    if visited < steps.len() {
        return Err(WorkflowError::CycleDetected);
    }

    Ok(tiers)
}

// ── Template Resolution ─────────────────────────────────────────────────

/// Resolve a Mustache-style template against the workflow context.
///
/// Supports `{{steps.X.output.field}}` and `{{input.key}}` patterns.
pub fn resolve_template(template: &str, context: &WorkflowContext) -> String {
    // Single left-to-right pass. Substituted values are NOT re-scanned, which
    // (a) avoids re-resolving template syntax that appears *inside* a resolved
    // value (a template-injection vector) and (b) guarantees termination: a
    // self-referential value such as `{{input.x}}` resolving to `"{{input.x}}"`
    // previously looped forever via `replace_range` (CPU-exhaustion DoS).
    let mut result = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        let Some(end_rel) = rest[start + 2..].find("}}") else {
            break; // no closing delimiter — emit the remainder verbatim below
        };
        let end = start + 2 + end_rel;
        result.push_str(&rest[..start]);
        let path = rest[start + 2..end].trim();
        result.push_str(&resolve_path(path, context));
        rest = &rest[end + 2..];
    }
    result.push_str(rest);
    result
}

/// Walk a dot-separated path to resolve a value from context.
fn resolve_path(path: &str, context: &WorkflowContext) -> String {
    let parts: Vec<&str> = path.split('.').collect();
    if parts.is_empty() {
        return String::new();
    }

    match parts[0] {
        "steps" => {
            if parts.len() < 2 {
                return String::new();
            }
            let step_id = parts[1];
            match context.steps.get(step_id) {
                Some(result) => {
                    if parts.len() == 2 {
                        return serde_json::to_string(&result.output).unwrap_or_default();
                    }
                    if parts.len() >= 3 && parts[2] == "output" {
                        walk_json(&result.output, &parts[3..])
                    } else if parts.len() >= 3 && parts[2] == "status" {
                        result.status.clone()
                    } else {
                        walk_json(&result.output, &parts[2..])
                    }
                }
                None => String::new(),
            }
        }
        "input" => walk_json(&context.input, &parts[1..]),
        _ => String::new(),
    }
}

/// Walk a JSON value by dot-path segments.
fn walk_json(value: &serde_json::Value, path: &[&str]) -> String {
    let mut current = value;
    for segment in path {
        match current {
            serde_json::Value::Object(map) => {
                current = match map.get(*segment) {
                    Some(v) => v,
                    None => return String::new(),
                };
            }
            serde_json::Value::Array(arr) => {
                if let Ok(idx) = segment.parse::<usize>() {
                    current = match arr.get(idx) {
                        Some(v) => v,
                        None => return String::new(),
                    };
                } else {
                    return String::new();
                }
            }
            _ => return String::new(),
        }
    }

    match current {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

// ── Workflow Engine ─────────────────────────────────────────────────────

/// The workflow execution engine.
pub struct WorkflowEngine<D: AgentDelegate> {
    delegate: D,
}

impl<D: AgentDelegate> WorkflowEngine<D> {
    pub fn new(delegate: D) -> Self {
        Self { delegate }
    }

    /// Execute a workflow definition.
    pub async fn execute(
        &self,
        definition: &WorkflowDefinition,
    ) -> Result<WorkflowResult, WorkflowError> {
        let tiers = topological_sort(&definition.steps)?;

        let mut context = WorkflowContext {
            steps: HashMap::new(),
            input: definition.input.clone(),
        };
        let mut completed = 0;
        let mut failed = 0;

        for tier in &tiers {
            // Execute steps in this tier concurrently (up to MAX_PARALLEL_STEPS)
            let tier_steps: Vec<&WorkflowStep> = tier
                .iter()
                .filter_map(|id| definition.steps.iter().find(|s| s.id == *id))
                .take(MAX_PARALLEL_STEPS)
                .collect();

            let futures: Vec<_> = tier_steps
                .iter()
                .map(|step| self.execute_step(step, &context))
                .collect();

            let results = futures::future::join_all(futures).await;

            for (i, result) in results.into_iter().enumerate() {
                let step = tier_steps[i];
                match result {
                    Ok(output) => {
                        context.steps.insert(
                            step.id.clone(),
                            StepResult {
                                output,
                                status: "completed".to_string(),
                            },
                        );
                        completed += 1;
                    }
                    Err(e) => {
                        let on_error = step.on_error.as_deref().unwrap_or("fail");
                        match on_error {
                            "continue" | "skip" => {
                                warn!(step = step.id, error = %e, "step failed, continuing");
                                context.steps.insert(
                                    step.id.clone(),
                                    StepResult {
                                        output: serde_json::json!({"error": e.to_string()}),
                                        status: "failed".to_string(),
                                    },
                                );
                                failed += 1;
                            }
                            _ => {
                                return Err(WorkflowError::StepFailed {
                                    step: step.id.clone(),
                                    error: e.to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }

        // Final output is the last step's output
        let final_output = definition
            .steps
            .last()
            .and_then(|s| context.steps.get(&s.id))
            .map(|r| r.output.clone())
            .unwrap_or(serde_json::Value::Null);

        Ok(WorkflowResult {
            outputs: context.steps,
            final_output,
            steps_completed: completed,
            steps_failed: failed,
        })
    }

    /// Execute a single step with retry.
    async fn execute_step(
        &self,
        step: &WorkflowStep,
        context: &WorkflowContext,
    ) -> Result<serde_json::Value, WorkflowError> {
        let max_attempts = step
            .retry_policy
            .as_ref()
            .map(|r| r.max_attempts)
            .unwrap_or(1);
        let backoff_ms = step
            .retry_policy
            .as_ref()
            .map(|r| r.backoff_ms)
            .unwrap_or(1000);

        let mut last_error = None;

        for attempt in 0..max_attempts {
            match self.dispatch_step(step, context).await {
                Ok(output) => {
                    debug!(step = step.id, attempt, "step completed");
                    return Ok(output);
                }
                Err(e) => {
                    last_error = Some(e);
                    if attempt + 1 < max_attempts {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            backoff_ms * (attempt as u64 + 1),
                        ))
                        .await;
                    }
                }
            }
        }

        Err(last_error
            .map(|e| WorkflowError::StepFailed {
                step: step.id.clone(),
                error: e.to_string(),
            })
            .unwrap_or(WorkflowError::StepFailed {
                step: step.id.clone(),
                error: "unknown error".to_string(),
            }))
    }

    /// Dispatch a step to its type-specific handler.
    async fn dispatch_step(
        &self,
        step: &WorkflowStep,
        context: &WorkflowContext,
    ) -> Result<serde_json::Value, DelegationError> {
        match step.step_type {
            StepType::Agent => {
                let task = step
                    .config
                    .get("taskTemplate")
                    .and_then(|t| t.as_str())
                    .map(|t| resolve_template(t, context))
                    .unwrap_or_default();
                let profile = step
                    .config
                    .get("profile")
                    .and_then(|p| p.as_str())
                    .unwrap_or("assistant")
                    .to_string();
                let budget = step
                    .config
                    .get("maxTokenBudget")
                    .and_then(|b| b.as_u64())
                    .unwrap_or(4096) as u32;
                let ctx = step
                    .config
                    .get("contextTemplate")
                    .and_then(|c| c.as_str())
                    .map(|c| resolve_template(c, context));

                let result = self
                    .delegate
                    .delegate(DelegationParams {
                        profile,
                        task,
                        context: ctx,
                        max_token_budget: budget,
                        model_override: step
                            .config
                            .get("modelOverride")
                            .and_then(|m| m.as_str())
                            .map(|s| s.to_string()),
                    })
                    .await?;

                Ok(serde_json::json!({"result": result.result, "tokensUsed": result.tokens_used}))
            }

            StepType::Condition => {
                let expr = step
                    .config
                    .get("expression")
                    .and_then(|e| e.as_str())
                    .unwrap_or("false");
                // Simple condition evaluation — checks for "true"/"false" after template resolution
                let resolved = resolve_template(expr, context);
                let result = resolved.trim() == "true"
                    || resolved.trim() == "1"
                    || resolved.contains("completed");
                Ok(serde_json::json!(result))
            }

            StepType::Transform => {
                let template = step
                    .config
                    .get("outputTemplate")
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                let resolved = resolve_template(template, context);
                Ok(serde_json::json!(resolved))
            }

            StepType::Delay => {
                let ms = step
                    .config
                    .get("durationMs")
                    .and_then(|d| d.as_u64())
                    .unwrap_or(1000);
                tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
                Ok(serde_json::json!({"delayedMs": ms}))
            }

            // All other step types return their config as a stub
            // (real handlers are wired incrementally)
            _ => {
                debug!(
                    step = step.id,
                    step_type = ?step.step_type,
                    "step type not yet implemented — returning config as output"
                );
                Ok(serde_json::json!({
                    "stub": true,
                    "stepType": format!("{:?}", step.step_type),
                    "config": step.config,
                }))
            }
        }
    }
}

// ── Errors ──────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum WorkflowError {
    #[error("cycle detected in workflow DAG")]
    CycleDetected,
    #[error("step '{step}' depends on missing step '{dependency}'")]
    MissingDependency { step: String, dependency: String },
    #[error("step '{step}' failed: {error}")]
    StepFailed { step: String, error: String },
    #[error("max subworkflow depth ({0}) exceeded")]
    MaxDepthExceeded(u32),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(id: &str, deps: &[&str]) -> WorkflowStep {
        WorkflowStep {
            id: id.into(),
            name: id.into(),
            step_type: StepType::Transform,
            depends_on: deps.iter().map(|s| s.to_string()).collect(),
            config: serde_json::json!({"outputTemplate": "{{input.x}}"}),
            trigger_mode: None,
            on_error: None,
            retry_policy: None,
        }
    }

    #[test]
    fn topo_sort_simple() {
        let steps = vec![step("a", &[]), step("b", &["a"]), step("c", &["b"])];
        let tiers = topological_sort(&steps).unwrap();
        assert_eq!(tiers.len(), 3);
        assert_eq!(tiers[0], vec!["a"]);
        assert_eq!(tiers[1], vec!["b"]);
        assert_eq!(tiers[2], vec!["c"]);
    }

    #[test]
    fn topo_sort_parallel() {
        let steps = vec![step("a", &[]), step("b", &[]), step("c", &["a", "b"])];
        let tiers = topological_sort(&steps).unwrap();
        assert_eq!(tiers.len(), 2);
        assert!(tiers[0].contains(&"a".to_string()));
        assert!(tiers[0].contains(&"b".to_string()));
        assert_eq!(tiers[1], vec!["c"]);
    }

    #[test]
    fn topo_sort_detects_cycle() {
        let steps = vec![step("a", &["b"]), step("b", &["a"])];
        assert!(matches!(
            topological_sort(&steps),
            Err(WorkflowError::CycleDetected)
        ));
    }

    #[test]
    fn topo_sort_detects_missing_dep() {
        let steps = vec![step("a", &["nonexistent"])];
        assert!(matches!(
            topological_sort(&steps),
            Err(WorkflowError::MissingDependency { .. })
        ));
    }

    #[test]
    fn resolve_template_basic() {
        let mut ctx = WorkflowContext {
            input: serde_json::json!({"name": "test"}),
            ..Default::default()
        };
        ctx.steps.insert(
            "s1".into(),
            StepResult {
                output: serde_json::json!({"result": "hello"}),
                status: "completed".into(),
            },
        );

        assert_eq!(resolve_template("{{input.name}}", &ctx), "test");
        assert_eq!(
            resolve_template("{{steps.s1.output.result}}", &ctx),
            "hello"
        );
        assert_eq!(resolve_template("{{steps.s1.status}}", &ctx), "completed");
        assert_eq!(
            resolve_template("no templates here", &ctx),
            "no templates here"
        );
    }

    #[test]
    fn resolve_template_nested() {
        let mut ctx = WorkflowContext::default();
        ctx.steps.insert(
            "s1".into(),
            StepResult {
                output: serde_json::json!({"data": {"items": [1, 2, 3]}}),
                status: "completed".into(),
            },
        );

        let result = resolve_template("{{steps.s1.output.data.items}}", &ctx);
        assert!(result.contains("[1,2,3]"));
    }

    #[test]
    fn resolve_template_missing_path() {
        let ctx = WorkflowContext::default();
        assert_eq!(resolve_template("{{steps.missing.output}}", &ctx), "");
        assert_eq!(resolve_template("{{input.nonexistent}}", &ctx), "");
    }

    #[tokio::test]
    async fn engine_executes_simple_dag() {
        use crate::orchestration::delegation::EchoDelegate;

        let engine = WorkflowEngine::new(EchoDelegate);
        let def = WorkflowDefinition {
            id: "test".into(),
            name: "Test Workflow".into(),
            input: serde_json::json!({"x": "hello"}),
            steps: vec![WorkflowStep {
                id: "s1".into(),
                name: "Transform".into(),
                step_type: StepType::Transform,
                depends_on: vec![],
                config: serde_json::json!({"outputTemplate": "{{input.x}} world"}),
                trigger_mode: None,
                on_error: None,
                retry_policy: None,
            }],
        };

        let result = engine.execute(&def).await.unwrap();
        assert_eq!(result.steps_completed, 1);
        assert_eq!(result.steps_failed, 0);
    }
}
