//! MCP tool registry — direct bote integration (no NAPI).
//!
//! Replaces sy-napi/src/bote.rs. Tool registration, schema validation,
//! and JSON-RPC protocol handled directly.

pub use bote::ToolRegistry;
pub use bote::schema::CompiledSchema;

/// Create a new tool registry.
pub fn create_registry() -> ToolRegistry {
    ToolRegistry::new()
}

/// Validate a tool call's input against its compiled schema.
pub fn validate_tool_input(
    registry: &ToolRegistry,
    tool_name: &str,
    input: &serde_json::Value,
) -> Result<(), Vec<String>> {
    let tool = registry
        .get(tool_name)
        .ok_or_else(|| vec![format!("tool not found: {tool_name}")])?;
    let compiled = CompiledSchema::compile(&tool.input_schema).map_err(|e| vec![e.to_string()])?;
    compiled.validate(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_empty_registry() {
        let registry = create_registry();
        assert!(registry.get("nonexistent").is_none());
    }
}
