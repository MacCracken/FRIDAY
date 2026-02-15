/**
 * Tool Manifest — static list of all MCP tools for auto-registration with core.
 *
 * All tools are always included in the manifest so they get persisted in core's DB.
 * Feature toggles (exposeGit, exposeFilesystem) control *visibility* at the API level,
 * not whether tools are registered.
 */

export interface ToolManifestEntry {
  name: string;
  description: string;
}

export function getToolManifest(): ToolManifestEntry[] {
  return [
    // Brain tools
    { name: 'knowledge_search', description: 'Search the FRIDAY knowledge base' },
    { name: 'knowledge_get', description: 'Get a specific knowledge entry by ID' },
    { name: 'knowledge_store', description: 'Store a new knowledge entry' },
    { name: 'memory_recall', description: 'Recall memories matching a query' },

    // Task tools
    { name: 'task_create', description: 'Create a new agent task' },
    { name: 'task_list', description: 'List tasks with optional filters' },
    { name: 'task_get', description: 'Get a specific task by ID' },
    { name: 'task_cancel', description: 'Cancel a running task' },

    // System tools
    { name: 'system_health', description: 'Check system health status' },
    { name: 'system_metrics', description: 'Get system performance metrics' },
    { name: 'system_config', description: 'Get current system configuration (secrets redacted)' },

    // Integration tools
    { name: 'integration_list', description: 'List all configured integrations' },
    { name: 'integration_send', description: 'Send a message via an integration' },
    { name: 'integration_status', description: 'Get integration connection status' },

    // Soul tools
    { name: 'personality_get', description: 'Get the active personality profile' },
    { name: 'personality_switch', description: 'Switch to a different personality' },
    { name: 'skill_list', description: 'List available skills' },
    { name: 'skill_execute', description: 'Execute a skill by name' },

    // Audit tools
    { name: 'audit_query', description: 'Query the audit log with filters' },
    { name: 'audit_verify', description: 'Verify audit chain integrity' },
    { name: 'audit_stats', description: 'Get audit statistics' },

    // Git & GitHub tools
    { name: 'git_status', description: 'Show working tree status for a git repository' },
    { name: 'git_log', description: 'Show commit log for a git repository' },
    { name: 'git_diff', description: 'Show changes between commits, working tree, etc.' },
    { name: 'git_branch_list', description: 'List branches in a git repository' },
    { name: 'git_commit', description: 'Create a new commit with staged changes' },
    { name: 'git_checkout', description: 'Switch branches or restore working tree files' },
    { name: 'git_show', description: 'Show details of a specific commit' },
    { name: 'github_pr_list', description: 'List pull requests for a GitHub repository' },
    { name: 'github_pr_view', description: 'View details of a specific pull request' },
    { name: 'github_pr_create', description: 'Create a new pull request' },
    { name: 'github_pr_diff', description: 'View the diff of a pull request' },
    { name: 'github_issue_list', description: 'List issues for a GitHub repository' },
    { name: 'github_issue_view', description: 'View details of a specific issue' },
    { name: 'github_issue_create', description: 'Create a new issue' },
    { name: 'github_repo_view', description: 'View repository information' },

    // Filesystem tools
    { name: 'fs_read', description: 'Read a file (path-restricted, admin-only)' },
    { name: 'fs_write', description: 'Write a file (path-restricted, admin-only)' },
    { name: 'fs_list', description: 'List directory contents (path-restricted, admin-only)' },
    { name: 'fs_search', description: 'Search files by pattern (path-restricted, admin-only)' },
  ];
}
