//! Swarm executor — multi-agent orchestration with strategy patterns.
//!
//! Three strategies:
//! - **Sequential**: agents execute in order, each seeing prior results
//! - **Parallel**: all agents execute concurrently, coordinator synthesizes
//! - **Dynamic**: coordinator LLM decides decomposition and delegation

use sqlx::PgPool;
use tracing::{debug, error};

use crate::db::agents;
use crate::orchestration::delegation::{AgentDelegate, DelegationError, DelegationParams};

/// Swarm execution strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwarmStrategy {
    Sequential,
    Parallel,
    Dynamic,
}

impl SwarmStrategy {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "sequential" => Self::Sequential,
            "dynamic" => Self::Dynamic,
            _ => Self::Parallel,
        }
    }
}

/// Configuration for a swarm role.
#[derive(Debug, Clone)]
pub struct SwarmRole {
    pub profile_name: String,
    pub role: String,
    pub description: String,
}

/// Result from a single swarm member's execution.
#[derive(Debug, Clone)]
pub struct MemberResult {
    pub role: String,
    pub profile: String,
    pub result: String,
    pub tokens_used: u32,
}

/// Complete result from a swarm execution.
#[derive(Debug, Clone)]
pub struct SwarmResult {
    pub result: String,
    pub members: Vec<MemberResult>,
    pub tokens_used: u32,
    pub strategy: SwarmStrategy,
}

/// Swarm executor — runs multi-agent orchestration.
pub struct SwarmExecutor<D: AgentDelegate> {
    delegate: D,
    pool: PgPool,
}

impl<D: AgentDelegate> SwarmExecutor<D> {
    pub fn new(delegate: D, pool: PgPool) -> Self {
        Self { delegate, pool }
    }

    /// Execute a swarm run.
    pub async fn execute(
        &self,
        run_id: &str,
        template: &agents::SwarmTemplateRow,
        task: &str,
        context: Option<&str>,
        token_budget: u32,
    ) -> Result<SwarmResult, DelegationError> {
        let roles = parse_roles(&template.roles);
        let strategy = SwarmStrategy::from_str(&template.strategy);

        debug!(run_id, strategy = ?strategy, roles = roles.len(), "starting swarm execution");

        let result = match strategy {
            SwarmStrategy::Sequential => {
                self.run_sequential(&roles, task, context, token_budget)
                    .await?
            }
            SwarmStrategy::Parallel => {
                self.run_parallel(
                    &roles,
                    template.coordinator_profile.as_deref(),
                    task,
                    context,
                    token_budget,
                )
                .await?
            }
            SwarmStrategy::Dynamic => {
                self.run_dynamic(
                    template
                        .coordinator_profile
                        .as_deref()
                        .unwrap_or("researcher"),
                    task,
                    context,
                    token_budget,
                )
                .await?
            }
        };

        // Update run status in DB
        let _ = sqlx::query(
            "UPDATE agents.swarm_runs SET status = 'completed', result = $1, tokens_used = $2, completed_at = NOW() WHERE id = $3",
        )
        .bind(&result.result)
        .bind(result.tokens_used as i32)
        .bind(run_id)
        .execute(&self.pool)
        .await;

        Ok(result)
    }

    /// Sequential: each agent executes in order, accumulating context.
    async fn run_sequential(
        &self,
        roles: &[SwarmRole],
        task: &str,
        context: Option<&str>,
        token_budget: u32,
    ) -> Result<SwarmResult, DelegationError> {
        let per_budget = token_budget / roles.len().max(1) as u32;
        let mut members = Vec::new();
        let mut accumulated_context = context.unwrap_or("").to_string();
        let mut total_tokens = 0u32;
        let mut last_result = String::new();

        for role in roles {
            let enriched_context = if accumulated_context.is_empty() {
                None
            } else {
                Some(accumulated_context.clone())
            };

            let delegation = self
                .delegate
                .delegate(DelegationParams {
                    profile: role.profile_name.clone(),
                    task: task.to_string(),
                    context: enriched_context,
                    max_token_budget: per_budget,
                    model_override: None,
                })
                .await?;

            accumulated_context.push_str(&format!(
                "\n\n[{} ({})]: {}",
                role.role, role.profile_name, delegation.result
            ));

            total_tokens += delegation.tokens_used;
            last_result = delegation.result.clone();

            members.push(MemberResult {
                role: role.role.clone(),
                profile: role.profile_name.clone(),
                result: delegation.result,
                tokens_used: delegation.tokens_used,
            });
        }

        Ok(SwarmResult {
            result: last_result,
            members,
            tokens_used: total_tokens,
            strategy: SwarmStrategy::Sequential,
        })
    }

    /// Parallel: all agents execute concurrently, coordinator synthesizes.
    async fn run_parallel(
        &self,
        roles: &[SwarmRole],
        coordinator_profile: Option<&str>,
        task: &str,
        context: Option<&str>,
        token_budget: u32,
    ) -> Result<SwarmResult, DelegationError> {
        let coordinator_count = if coordinator_profile.is_some() { 1 } else { 0 };
        let per_budget = token_budget / (roles.len() as u32 + coordinator_count).max(1);

        // Dispatch all members concurrently
        let futures: Vec<_> = roles
            .iter()
            .map(|role| {
                self.delegate.delegate(DelegationParams {
                    profile: role.profile_name.clone(),
                    task: task.to_string(),
                    context: context.map(|c| c.to_string()),
                    max_token_budget: per_budget,
                    model_override: None,
                })
            })
            .collect();

        let results = futures::future::join_all(futures).await;

        let mut members = Vec::new();
        let mut total_tokens = 0u32;
        let mut synthesis_context = String::new();

        for (i, result) in results.into_iter().enumerate() {
            match result {
                Ok(delegation) => {
                    let role = &roles[i];
                    synthesis_context.push_str(&format!(
                        "[{} ({})]\n{}\n\n",
                        role.role, role.profile_name, delegation.result
                    ));
                    total_tokens += delegation.tokens_used;
                    members.push(MemberResult {
                        role: role.role.clone(),
                        profile: role.profile_name.clone(),
                        result: delegation.result,
                        tokens_used: delegation.tokens_used,
                    });
                }
                Err(e) => {
                    error!(role = roles[i].role, error = %e, "swarm member failed");
                    members.push(MemberResult {
                        role: roles[i].role.clone(),
                        profile: roles[i].profile_name.clone(),
                        result: format!("ERROR: {e}"),
                        tokens_used: 0,
                    });
                }
            }
        }

        // Coordinator synthesizes if configured
        let final_result = if let Some(coordinator) = coordinator_profile {
            let synth = self
                .delegate
                .delegate(DelegationParams {
                    profile: coordinator.to_string(),
                    task: format!(
                        "Synthesize the following results for the task: {task}\n\n{synthesis_context}"
                    ),
                    context: context.map(|c| c.to_string()),
                    max_token_budget: per_budget,
                    model_override: None,
                })
                .await?;
            total_tokens += synth.tokens_used;
            synth.result
        } else {
            synthesis_context
        };

        Ok(SwarmResult {
            result: final_result,
            members,
            tokens_used: total_tokens,
            strategy: SwarmStrategy::Parallel,
        })
    }

    /// Dynamic: coordinator decides decomposition and delegation.
    async fn run_dynamic(
        &self,
        coordinator_profile: &str,
        task: &str,
        context: Option<&str>,
        token_budget: u32,
    ) -> Result<SwarmResult, DelegationError> {
        let delegation = self
            .delegate
            .delegate(DelegationParams {
                profile: coordinator_profile.to_string(),
                task: task.to_string(),
                context: context.map(|c| c.to_string()),
                max_token_budget: token_budget,
                model_override: None,
            })
            .await?;

        Ok(SwarmResult {
            result: delegation.result.clone(),
            members: vec![MemberResult {
                role: "coordinator".to_string(),
                profile: coordinator_profile.to_string(),
                result: delegation.result,
                tokens_used: delegation.tokens_used,
            }],
            tokens_used: delegation.tokens_used,
            strategy: SwarmStrategy::Dynamic,
        })
    }
}

/// Parse roles from JSON value.
fn parse_roles(roles_json: &serde_json::Value) -> Vec<SwarmRole> {
    roles_json
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    Some(SwarmRole {
                        profile_name: v.get("profileName")?.as_str()?.to_string(),
                        role: v.get("role")?.as_str()?.to_string(),
                        description: v
                            .get("description")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_roles() -> Vec<SwarmRole> {
        vec![
            SwarmRole {
                profile_name: "researcher".into(),
                role: "Research".into(),
                description: "Conducts research".into(),
            },
            SwarmRole {
                profile_name: "writer".into(),
                role: "Writing".into(),
                description: "Writes content".into(),
            },
        ]
    }

    #[test]
    fn parse_roles_from_json() {
        let json = serde_json::json!([
            {"profileName": "researcher", "role": "Research", "description": "Researches"},
            {"profileName": "writer", "role": "Writing"}
        ]);
        let roles = parse_roles(&json);
        assert_eq!(roles.len(), 2);
        assert_eq!(roles[0].profile_name, "researcher");
        assert_eq!(roles[1].description, "");
    }

    #[test]
    fn parse_roles_empty() {
        let roles = parse_roles(&serde_json::json!(null));
        assert!(roles.is_empty());
    }

    #[test]
    fn strategy_from_str() {
        assert_eq!(
            SwarmStrategy::from_str("sequential"),
            SwarmStrategy::Sequential
        );
        assert_eq!(SwarmStrategy::from_str("parallel"), SwarmStrategy::Parallel);
        assert_eq!(SwarmStrategy::from_str("dynamic"), SwarmStrategy::Dynamic);
        assert_eq!(SwarmStrategy::from_str("unknown"), SwarmStrategy::Parallel);
    }
}
