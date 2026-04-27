//! Council executor — multi-round deliberation with voting strategies.
//!
//! Models group decision-making:
//! 1. Each member submits a position on the topic
//! 2. Members see prior positions and can rebut/agree/disagree
//! 3. Continues for N rounds or until consensus
//! 4. Facilitator synthesizes final decision using the chosen voting strategy

use sqlx::PgPool;
use tracing::{debug, warn};

use crate::db::agents;
use crate::orchestration::delegation::{AgentDelegate, DelegationError, DelegationParams};

/// Deliberation strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliberationStrategy {
    /// Fixed number of rounds.
    Rounds,
    /// Run until facilitator judges consensus.
    UntilConsensus,
    /// Single round, no rebuttal.
    SinglePass,
}

impl DeliberationStrategy {
    pub fn parse_or_default(s: &str) -> Self {
        match s {
            "until_consensus" => Self::UntilConsensus,
            "single_pass" => Self::SinglePass,
            _ => Self::Rounds,
        }
    }
}

/// Voting strategy for synthesis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VotingStrategy {
    FacilitatorJudgment,
    Majority,
    Unanimous,
    Weighted,
}

impl VotingStrategy {
    pub fn parse_or_default(s: &str) -> Self {
        match s {
            "majority" => Self::Majority,
            "unanimous" => Self::Unanimous,
            "weighted" => Self::Weighted,
            _ => Self::FacilitatorJudgment,
        }
    }
}

/// A member's position in a round.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Position {
    pub member_role: String,
    pub profile_name: String,
    pub round: u32,
    pub position: String,
    pub confidence: f64,
}

/// Synthesis result from the facilitator.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SynthesisResult {
    pub decision: String,
    pub consensus: String,
    pub dissents: Vec<String>,
    pub reasoning: String,
    pub confidence: f64,
}

/// Complete result from a council execution.
#[derive(Debug, Clone)]
pub struct CouncilResult {
    pub decision: String,
    pub consensus: String,
    pub dissents: Vec<String>,
    pub reasoning: String,
    pub confidence: f64,
    pub rounds_completed: u32,
    pub positions: Vec<Position>,
    pub tokens_used: u32,
}

/// Council member configuration.
#[derive(Debug, Clone)]
pub struct CouncilMember {
    pub role: String,
    pub profile_name: String,
    pub description: String,
    pub perspective: String,
    pub weight: f64,
}

/// Council executor.
pub struct CouncilExecutor<D: AgentDelegate> {
    delegate: D,
    pool: PgPool,
}

impl<D: AgentDelegate> CouncilExecutor<D> {
    pub fn new(delegate: D, pool: PgPool) -> Self {
        Self { delegate, pool }
    }

    /// Execute a council deliberation.
    pub async fn execute(
        &self,
        run_id: &str,
        template: &agents::CouncilTemplateRow,
        topic: &str,
        context: Option<&str>,
        token_budget: u32,
        max_rounds: u32,
    ) -> Result<CouncilResult, DelegationError> {
        let members = parse_members(&template.members);
        let strategy = DeliberationStrategy::parse_or_default(&template.deliberation_strategy);
        let voting = VotingStrategy::parse_or_default(&template.voting_strategy);
        let facilitator = template
            .facilitator_profile
            .as_deref()
            .unwrap_or("facilitator");

        let effective_max_rounds = match strategy {
            DeliberationStrategy::SinglePass => 1,
            _ => max_rounds.max(1),
        };

        // Budget: split across rounds × members + synthesis
        let calls_estimate = (effective_max_rounds * members.len() as u32 + 1).max(1);
        let per_call_budget = token_budget / calls_estimate;

        let mut all_positions: Vec<Position> = Vec::new();
        let mut total_tokens = 0u32;

        debug!(
            run_id,
            members = members.len(),
            strategy = ?strategy,
            max_rounds = effective_max_rounds,
            "starting council deliberation"
        );

        for round in 1..=effective_max_rounds {
            // Build prior positions for context (rounds > 1)
            let prior_context = if round > 1 {
                format_prior_positions(&all_positions, round - 1)
            } else {
                String::new()
            };

            // Dispatch to all members in parallel
            let futures: Vec<_> = members
                .iter()
                .map(|member| {
                    let prompt = build_member_prompt(member, topic, context, round, &prior_context);
                    self.delegate.delegate(DelegationParams {
                        profile: member.profile_name.clone(),
                        task: prompt,
                        context: None,
                        max_token_budget: per_call_budget,
                        model_override: None,
                    })
                })
                .collect();

            let results = futures::future::join_all(futures).await;

            for (i, result) in results.into_iter().enumerate() {
                match result {
                    Ok(delegation) => {
                        total_tokens += delegation.tokens_used;
                        all_positions.push(Position {
                            member_role: members[i].role.clone(),
                            profile_name: members[i].profile_name.clone(),
                            round,
                            position: delegation.result,
                            confidence: 0.7, // default, could be parsed from response
                        });
                    }
                    Err(e) => {
                        warn!(
                            member = members[i].role,
                            round,
                            error = %e,
                            "council member failed"
                        );
                    }
                }
            }

            // Check convergence for until_consensus strategy
            if strategy == DeliberationStrategy::UntilConsensus && round < effective_max_rounds {
                let converged = self
                    .check_convergence(facilitator, topic, &all_positions, round, per_call_budget)
                    .await;
                if let Ok((true, tokens)) = converged {
                    total_tokens += tokens;
                    debug!(round, "council reached consensus early");
                    break;
                }
            }
        }

        // Synthesize final decision
        let synthesis = self
            .synthesize(
                facilitator,
                topic,
                voting,
                &all_positions,
                per_call_budget * 2,
            )
            .await?;
        total_tokens += synthesis.tokens_used;

        let rounds_completed = all_positions.iter().map(|p| p.round).max().unwrap_or(0);

        let result = CouncilResult {
            decision: synthesis.decision.clone(),
            consensus: synthesis.consensus.clone(),
            dissents: synthesis.dissents.clone(),
            reasoning: synthesis.reasoning.clone(),
            confidence: synthesis.confidence,
            rounds_completed,
            positions: all_positions,
            tokens_used: total_tokens,
        };

        // Update run in DB
        let _ = sqlx::query(
            "UPDATE agents.council_runs SET status = 'completed', result = $1, rounds_completed = $2, tokens_used = $3, completed_at = NOW() WHERE id = $4",
        )
        .bind(&result.decision)
        .bind(rounds_completed as i32)
        .bind(total_tokens as i32)
        .bind(run_id)
        .execute(&self.pool)
        .await;

        Ok(result)
    }

    /// Check if the council has reached consensus.
    async fn check_convergence(
        &self,
        facilitator: &str,
        topic: &str,
        positions: &[Position],
        round: u32,
        budget: u32,
    ) -> Result<(bool, u32), DelegationError> {
        let positions_text = format_prior_positions(positions, round);
        let prompt = format!(
            "You are evaluating whether a council has reached consensus on: \"{topic}\"\n\n\
             {positions_text}\n\n\
             Have the members converged on a shared position? \
             Respond ONLY with JSON: {{\"converged\": true/false, \"reason\": \"...\"}}"
        );

        let result = self
            .delegate
            .delegate(DelegationParams {
                profile: facilitator.to_string(),
                task: prompt,
                context: None,
                max_token_budget: budget,
                model_override: None,
            })
            .await?;

        let converged = result.result.contains("\"converged\": true")
            || result.result.contains("\"converged\":true");

        Ok((converged, result.tokens_used))
    }

    /// Synthesize the final decision from all positions.
    async fn synthesize(
        &self,
        facilitator: &str,
        topic: &str,
        voting: VotingStrategy,
        positions: &[Position],
        budget: u32,
    ) -> Result<SynthesisWithTokens, DelegationError> {
        let history = format_deliberation_history(positions);
        let voting_str = match voting {
            VotingStrategy::FacilitatorJudgment => "facilitator_judgment",
            VotingStrategy::Majority => "majority",
            VotingStrategy::Unanimous => "unanimous",
            VotingStrategy::Weighted => "weighted",
        };

        let prompt = format!(
            "Topic: \"{topic}\"\n\
             Voting strategy: \"{voting_str}\"\n\n\
             Full deliberation history:\n{history}\n\n\
             Synthesize the final decision. Respond ONLY with JSON:\n\
             {{\n  \"decision\": \"The final decision...\",\n  \
             \"consensus\": \"full\" | \"majority\" | \"split\",\n  \
             \"dissents\": [\"Minority position...\"],\n  \
             \"reasoning\": \"How this decision was reached...\",\n  \
             \"confidence\": 0.0-1.0\n}}"
        );

        let result = self
            .delegate
            .delegate(DelegationParams {
                profile: facilitator.to_string(),
                task: prompt,
                context: None,
                max_token_budget: budget,
                model_override: None,
            })
            .await?;

        // Try to parse JSON from the response
        let synthesis: SynthesisResult =
            serde_json::from_str(&result.result).unwrap_or_else(|_| SynthesisResult {
                decision: result.result.clone(),
                consensus: "split".to_string(),
                dissents: vec![],
                reasoning: "Could not parse structured response".to_string(),
                confidence: 0.5,
            });

        Ok(SynthesisWithTokens {
            decision: synthesis.decision,
            consensus: synthesis.consensus,
            dissents: synthesis.dissents,
            reasoning: synthesis.reasoning,
            confidence: synthesis.confidence,
            tokens_used: result.tokens_used,
        })
    }
}

struct SynthesisWithTokens {
    decision: String,
    consensus: String,
    dissents: Vec<String>,
    reasoning: String,
    confidence: f64,
    tokens_used: u32,
}

/// Build a prompt for a council member.
fn build_member_prompt(
    member: &CouncilMember,
    topic: &str,
    context: Option<&str>,
    round: u32,
    prior_positions: &str,
) -> String {
    let mut prompt = format!(
        "You are \"{role}\" — {description}\n\
         Perspective: {perspective}\n\n\
         Topic for deliberation: \"{topic}\"\n",
        role = member.role,
        description = member.description,
        perspective = member.perspective,
    );

    if let Some(ctx) = context {
        prompt.push_str(&format!("\nContext: {ctx}\n"));
    }

    if round > 1 && !prior_positions.is_empty() {
        prompt.push_str(&format!(
            "\nPrior positions from other members:\n{prior_positions}\n"
        ));
        prompt.push_str(
            "\nConsider the other positions. You may agree, disagree, or refine your view.\n",
        );
    }

    prompt.push_str(
        "\nProvide your position clearly and concisely. \
         State your key points and confidence level (0-1).\n",
    );

    prompt
}

/// Format positions from a specific round for context.
fn format_prior_positions(positions: &[Position], up_to_round: u32) -> String {
    let mut lines = Vec::new();
    for p in positions.iter().filter(|p| p.round <= up_to_round) {
        lines.push(format!(
            "[{} (round {})] (confidence: {:.1}): {}",
            p.member_role, p.round, p.confidence, p.position
        ));
    }
    lines.join("\n\n")
}

/// Format full deliberation history for synthesis.
fn format_deliberation_history(positions: &[Position]) -> String {
    let max_round = positions.iter().map(|p| p.round).max().unwrap_or(0);
    let mut lines = Vec::new();

    for round in 1..=max_round {
        lines.push(format!("--- Round {round} ---"));
        for p in positions.iter().filter(|p| p.round == round) {
            lines.push(format!(
                "[{}] (confidence: {:.1}): {}",
                p.member_role, p.confidence, p.position
            ));
        }
        lines.push(String::new());
    }

    lines.join("\n")
}

/// Parse council members from JSON.
fn parse_members(members_json: &serde_json::Value) -> Vec<CouncilMember> {
    members_json
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    Some(CouncilMember {
                        role: v.get("role")?.as_str()?.to_string(),
                        profile_name: v.get("profileName")?.as_str()?.to_string(),
                        description: v
                            .get("description")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string(),
                        perspective: v
                            .get("perspective")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string(),
                        weight: v.get("weight").and_then(|w| w.as_f64()).unwrap_or(1.0),
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
            {"role": "Expert", "profileName": "expert-1", "description": "Domain expert", "perspective": "Technical", "weight": 1.5},
            {"role": "Critic", "profileName": "critic-1"}
        ]);
        let members = parse_members(&json);
        assert_eq!(members.len(), 2);
        assert_eq!(members[0].weight, 1.5);
        assert_eq!(members[1].description, "");
    }

    #[test]
    fn deliberation_strategy_from_str() {
        assert_eq!(
            DeliberationStrategy::parse_or_default("until_consensus"),
            DeliberationStrategy::UntilConsensus
        );
        assert_eq!(
            DeliberationStrategy::parse_or_default("single_pass"),
            DeliberationStrategy::SinglePass
        );
        assert_eq!(
            DeliberationStrategy::parse_or_default("rounds"),
            DeliberationStrategy::Rounds
        );
    }

    #[test]
    fn format_history_groups_by_round() {
        let positions = vec![
            Position {
                member_role: "Expert".into(),
                profile_name: "e".into(),
                round: 1,
                position: "Position A".into(),
                confidence: 0.8,
            },
            Position {
                member_role: "Critic".into(),
                profile_name: "c".into(),
                round: 1,
                position: "Position B".into(),
                confidence: 0.6,
            },
            Position {
                member_role: "Expert".into(),
                profile_name: "e".into(),
                round: 2,
                position: "Revised A".into(),
                confidence: 0.9,
            },
        ];
        let history = format_deliberation_history(&positions);
        assert!(history.contains("--- Round 1 ---"));
        assert!(history.contains("--- Round 2 ---"));
        assert!(history.contains("Position A"));
        assert!(history.contains("Revised A"));
    }
}
