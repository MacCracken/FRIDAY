//! Workflow primitives — direct szal integration (no NAPI).
//!
//! Replaces sy-napi/src/szal.rs. Condition evaluation, template resolution,
//! and flow validation call szal directly.

/// Evaluate a condition expression against a JSON context.
pub fn evaluate_condition(expr: &str, context: &serde_json::Value) -> bool {
    szal::condition::evaluate(expr, context).unwrap_or(false)
}

/// Resolve a template string against a JSON context.
pub fn resolve_template(template: &str, context: &serde_json::Value) -> String {
    szal::condition::render_template(template, context)
}

/// Validate a workflow flow definition for cycles and missing dependencies.
pub fn validate_flow(flow: &szal::flow::FlowDef) -> Result<(), String> {
    flow.validate().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluate_true_literal() {
        let ctx = serde_json::json!({});
        assert!(evaluate_condition("true", &ctx));
        assert!(!evaluate_condition("false", &ctx));
    }

    #[test]
    fn resolve_simple_template() {
        let ctx = serde_json::json!({"name": "world"});
        let result = resolve_template("hello {{name}}", &ctx);
        assert_eq!(result, "hello world");
    }
}
