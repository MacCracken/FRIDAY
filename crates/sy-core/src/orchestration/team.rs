//! Team executor — LLM-directed dynamic agent assignment.
//!
//! Unlike swarms (static topology), teams use a coordinator LLM to decide
//! which agents should handle which parts of a task. The coordinator sees
//! member descriptions and dynamically assigns work.

use sqlx::PgPool;
use tracing::{debug, warn};

use crate::db::agents;
use crate::orchestration::delegation::{AgentDelegate, DelegationError, DelegationParams};

/// Team member definition.
#[derive(Debug, Clone)]
pub struct TeamMember {
    pub profile_name: String,
    pub role: String,
    pub description: String,
}

/// Result from a team execution.
#[derive(Debug, Clone)]
pub struct TeamResult {
    pub result: String,
    pub assigned_to: Vec<String>,
    pub reasoning: String,
    pub tokens_used: u32,
}

/// Team executor.
pub struct TeamExecutor<D: AgentDelegate> {
    delegate: D,
    pool: PgPool,
}

impl<D: AgentDelegate> TeamExecutor<D> {
    pub fn new(delegate: D, pool: PgPool) -> Self {
        Self { delegate, pool }
    }

    /// Execute a team run.
    ///
    /// 1. Coordinator LLM decides which members to assign
    /// 2. Assigned members execute in parallel
    /// 3. If multiple results, coordinator synthesizes
    pub async fn execute(
        &self,
        run_id: &str,
        team: &agents::TeamRow,
        task: &str,
        context: Option<&str>,
        token_budget: u32,
    ) -> Result<TeamResult, DelegationError> {
        let members = parse_members(&team.members);

        debug!(run_id, members = members.len(), "starting team execution");

        // Step 1: Coordinator decides assignments
        let (assigned, reasoning, coord_tokens) = self
            .coordinator_assign(&members, task, context, token_budget / 3)
            .await?;

        debug!(run_id, assigned = ?assigned, "coordinator assigned members");

        if assigned.is_empty() {
            return Err(DelegationError::Failed(
                "Coordinator assigned no members".into(),
            ));
        }

        // Step 2: Dispatch to assigned members
        let remaining_budget = token_budget.saturating_sub(coord_tokens);
        let per_budget = remaining_budget / (assigned.len() as u32 + 1).max(1); // +1 for synthesis

        let mut results = Vec::new();
        let mut total_tokens = coord_tokens;

        if assigned.len() == 1 {
            // Single assignment — no synthesis needed
            let delegation = self
                .delegate
                .delegate(DelegationParams {
                    profile: assigned[0].clone(),
                    task: task.to_string(),
                    context: context.map(|c| c.to_string()),
                    max_token_budget: remaining_budget,
                    model_override: None,
                })
                .await?;
            total_tokens += delegation.tokens_used;
            results.push(delegation.result);
        } else {
            // Parallel dispatch
            let futures: Vec<_> = assigned
                .iter()
                .map(|profile| {
                    self.delegate.delegate(DelegationParams {
                        profile: profile.clone(),
                        task: task.to_string(),
                        context: context.map(|c| c.to_string()),
                        max_token_budget: per_budget,
                        model_override: None,
                    })
                })
                .collect();

            for result in futures::future::join_all(futures).await {
                match result {
                    Ok(d) => {
                        total_tokens += d.tokens_used;
                        results.push(d.result);
                    }
                    Err(e) => {
                        warn!(error = %e, "team member delegation failed");
                    }
                }
            }
        }

        // Step 3: Synthesize if multiple results
        let final_result = if results.len() > 1 {
            let combined = results
                .iter()
                .enumerate()
                .map(|(i, r)| format!("[Result {}]:\n{r}", i + 1))
                .collect::<Vec<_>>()
                .join("\n\n");

            let synth = self
                .delegate
                .delegate(DelegationParams {
                    profile: assigned[0].clone(), // Use first assigned as synthesizer
                    task: format!(
                        "Combine the following results for the task: {task}\n\n{combined}"
                    ),
                    context: None,
                    max_token_budget: per_budget,
                    model_override: None,
                })
                .await?;
            total_tokens += synth.tokens_used;
            synth.result
        } else {
            results.into_iter().next().unwrap_or_default()
        };

        let result = TeamResult {
            result: final_result.clone(),
            assigned_to: assigned,
            reasoning,
            tokens_used: total_tokens,
        };

        // Update run in DB
        let _ = sqlx::query(
            "UPDATE agents.team_runs SET status = 'completed', result = $1, tokens_used = $2, completed_at = NOW() WHERE id = $3",
        )
        .bind(&final_result)
        .bind(total_tokens as i32)
        .bind(run_id)
        .execute(&self.pool)
        .await;

        Ok(result)
    }

    /// Ask the coordinator LLM to decide member assignments.
    async fn coordinator_assign(
        &self,
        members: &[TeamMember],
        task: &str,
        context: Option<&str>,
        budget: u32,
    ) -> Result<(Vec<String>, String, u32), DelegationError> {
        let member_list = members
            .iter()
            .map(|m| {
                format!(
                    "- {} (profile: {}): {}",
                    m.role, m.profile_name, m.description
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        let mut prompt = format!(
            "You are a team coordinator. Given the task below, decide which team members should work on it.\n\n\
             Team members:\n{member_list}\n\n\
             Task: {task}\n"
        );

        if let Some(ctx) = context {
            prompt.push_str(&format!("Context: {ctx}\n"));
        }

        prompt.push_str(
            "\nRespond ONLY with JSON: {\"assignTo\": [\"profileName1\", ...], \"reasoning\": \"...\"}\n",
        );

        // Use the first member's profile as coordinator (or a generic one)
        let coordinator_profile = members
            .first()
            .map(|m| m.profile_name.clone())
            .unwrap_or_else(|| "coordinator".to_string());

        let result = self
            .delegate
            .delegate(DelegationParams {
                profile: coordinator_profile,
                task: prompt,
                context: None,
                max_token_budget: budget.min(512),
                model_override: None,
            })
            .await?;

        // Parse coordinator decision
        let valid_profiles: std::collections::HashSet<&str> =
            members.iter().map(|m| m.profile_name.as_str()).collect();

        let (assigned, reasoning) = parse_assignment(&result.result, &valid_profiles);

        // Fallback: assign all members if parsing fails
        let assigned = if assigned.is_empty() {
            members.iter().map(|m| m.profile_name.clone()).collect()
        } else {
            assigned
        };

        Ok((assigned, reasoning, result.tokens_used))
    }
}

/// Parse the coordinator's assignment decision from JSON.
fn parse_assignment(
    response: &str,
    valid_profiles: &std::collections::HashSet<&str>,
) -> (Vec<String>, String) {
    // Try to find JSON in the response
    let json_start = response.find('{');
    let json_end = response.rfind('}');

    if let (Some(start), Some(end)) = (json_start, json_end)
        && let Ok(v) = serde_json::from_str::<serde_json::Value>(&response[start..=end])
    {
        let assigned: Vec<String> = v
            .get("assignTo")
            .and_then(|a| a.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .filter(|name| valid_profiles.contains(name))
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();

        let reasoning = v
            .get("reasoning")
            .and_then(|r| r.as_str())
            .unwrap_or("")
            .to_string();

        return (assigned, reasoning);
    }

    (
        Vec::new(),
        "Could not parse coordinator response".to_string(),
    )
}

/// Parse team members from JSON value.
fn parse_members(members_json: &serde_json::Value) -> Vec<TeamMember> {
    members_json
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    Some(TeamMember {
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

    #[test]
    fn parse_members_from_json() {
        let json = serde_json::json!([
            {"profileName": "researcher", "role": "Research Lead", "description": "Conducts research"},
            {"profileName": "developer", "role": "Developer"}
        ]);
        let members = parse_members(&json);
        assert_eq!(members.len(), 2);
        assert_eq!(members[0].description, "Conducts research");
        assert_eq!(members[1].description, "");
    }

    #[test]
    fn parse_assignment_valid_json() {
        let valid = std::collections::HashSet::from(["researcher", "developer"]);
        let response = r#"{"assignTo": ["researcher", "developer"], "reasoning": "Both needed"}"#;
        let (assigned, reasoning) = parse_assignment(response, &valid);
        assert_eq!(assigned, vec!["researcher", "developer"]);
        assert_eq!(reasoning, "Both needed");
    }

    #[test]
    fn parse_assignment_filters_invalid() {
        let valid = std::collections::HashSet::from(["researcher"]);
        let response = r#"{"assignTo": ["researcher", "hacker"], "reasoning": "test"}"#;
        let (assigned, _) = parse_assignment(response, &valid);
        assert_eq!(assigned, vec!["researcher"]);
    }

    #[test]
    fn parse_assignment_handles_garbage() {
        let valid = std::collections::HashSet::from(["researcher"]);
        let (assigned, _) = parse_assignment("not json at all", &valid);
        assert!(assigned.is_empty());
    }

    #[test]
    fn parse_assignment_extracts_json_from_text() {
        let valid = std::collections::HashSet::from(["dev"]);
        let response =
            "Here is my decision: {\"assignTo\": [\"dev\"], \"reasoning\": \"best fit\"} end";
        let (assigned, reasoning) = parse_assignment(response, &valid);
        assert_eq!(assigned, vec!["dev"]);
        assert_eq!(reasoning, "best fit");
    }
}
