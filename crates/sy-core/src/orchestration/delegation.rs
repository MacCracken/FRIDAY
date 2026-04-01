//! Agent delegation trait — shared interface for LLM task delegation.
//!
//! All orchestration patterns (workflow, swarm, council, team) delegate
//! tasks through this trait. The concrete implementation calls the LLM
//! provider (via Hoosh/Ifran/direct API).

use std::future::Future;

/// Parameters for a single agent delegation.
#[derive(Debug, Clone)]
pub struct DelegationParams {
    /// Agent profile name or ID.
    pub profile: String,
    /// Task description.
    pub task: String,
    /// Additional context (prior results, conversation history, etc.).
    pub context: Option<String>,
    /// Maximum token budget for this delegation.
    pub max_token_budget: u32,
    /// Model override (bypasses profile default).
    pub model_override: Option<String>,
}

/// Result of a single agent delegation.
#[derive(Debug, Clone)]
pub struct DelegationResult {
    /// Delegation ID for tracking.
    pub id: String,
    /// The agent's response text.
    pub result: String,
    /// Tokens used (prompt + completion).
    pub tokens_used: u32,
    /// Whether the delegation completed successfully.
    pub success: bool,
    /// Error message if failed.
    pub error: Option<String>,
}

/// Error from a delegation operation.
#[derive(Debug, thiserror::Error)]
pub enum DelegationError {
    #[error("delegation failed: {0}")]
    Failed(String),
    #[error("profile not found: {0}")]
    ProfileNotFound(String),
    #[error("token budget exceeded")]
    BudgetExceeded,
    #[error("timeout after {0}ms")]
    Timeout(u64),
}

/// Agent delegation interface.
///
/// Concrete implementations wrap the LLM provider (Hoosh, Ifran, direct API).
/// The orchestration layer calls `delegate()` without knowing which provider
/// handles the request.
pub trait AgentDelegate: Send + Sync {
    /// Delegate a task to an agent and wait for the result.
    fn delegate(
        &self,
        params: DelegationParams,
    ) -> impl Future<Output = Result<DelegationResult, DelegationError>> + Send;
}

/// A no-op delegate for testing — returns the task as the result.
pub struct EchoDelegate;

impl AgentDelegate for EchoDelegate {
    async fn delegate(
        &self,
        params: DelegationParams,
    ) -> Result<DelegationResult, DelegationError> {
        Ok(DelegationResult {
            id: uuid::Uuid::now_v7().to_string(),
            result: format!("[{}] {}", params.profile, params.task),
            tokens_used: 0,
            success: true,
            error: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn echo_delegate_returns_task() {
        let delegate = EchoDelegate;
        let result = delegate
            .delegate(DelegationParams {
                profile: "researcher".into(),
                task: "Find information about X".into(),
                context: None,
                max_token_budget: 1000,
                model_override: None,
            })
            .await
            .unwrap();
        assert!(result.result.contains("Find information"));
        assert!(result.success);
    }
}
