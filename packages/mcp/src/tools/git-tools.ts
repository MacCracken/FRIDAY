/**
 * Git & GitHub Tools — local git operations and GitHub CLI integration.
 *
 * Requires `git` on PATH. GitHub tools additionally require `gh` CLI
 * authenticated via `gh auth login`.
 *
 * Opt-in via MCP_EXPOSE_GIT=true. Operations are restricted to
 * allowedGitPaths (falls back to allowedPaths if empty).
 */

import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServiceConfig } from '@friday/shared';
import type { ToolMiddleware } from './index.js';
import { wrapToolHandler } from './tool-utils.js';

const MAX_OUTPUT = 100_000; // truncate output at 100KB

function getAllowedPaths(config: McpServiceConfig): string[] {
  return config.allowedPaths;
}

function validateCwd(cwd: string, config: McpServiceConfig): string {
  const resolved = path.resolve(cwd);
  const allowed = getAllowedPaths(config);

  // If no paths configured, allow any directory
  if (allowed.length === 0) return resolved;

  const ok = allowed.some((p) => resolved.startsWith(path.resolve(p)));
  if (!ok) {
    throw new Error(`Path "${resolved}" is outside allowed git paths: ${allowed.join(', ')}`);
  }
  return resolved;
}

function exec(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, maxBuffer: 5 * 1024 * 1024, timeout: 30_000 },
      (error: Error | null, stdout, stderr) => {
        if (error && !stdout && !stderr) {
          reject(error);
          return;
        }
        // Many git commands write to stderr for informational output
        // so we resolve even if there's an error code, returning both streams
        resolve({
          stdout:
            stdout.length > MAX_OUTPUT ? stdout.slice(0, MAX_OUTPUT) + '\n...[truncated]' : stdout,
          stderr:
            stderr.length > MAX_OUTPUT ? stderr.slice(0, MAX_OUTPUT) + '\n...[truncated]' : stderr,
        });
      }
    );
  });
}

function formatResult(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(stdout.trim());
  if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`);
  return parts.join('\n\n') || '(no output)';
}

export function registerGitTools(
  server: McpServer,
  config: McpServiceConfig,
  middleware: ToolMiddleware
): void {
  // -- Git Tools --

  server.registerTool(
    'git_status',
    {
      description: 'Show working tree status for a git repository',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        short: z.boolean().default(false).describe('Use short format'),
      },
    },
    wrapToolHandler('git_status', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const gitArgs = ['status'];
      if (args.short) gitArgs.push('--short');
      const { stdout, stderr } = await exec('git', gitArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'git_log',
    {
      description: 'Show commit history',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        maxCount: z.number().int().min(1).max(100).default(20).describe('Number of commits'),
        oneline: z.boolean().default(true).describe('One line per commit'),
        branch: z.string().optional().describe('Branch or ref to show log for'),
      },
    },
    wrapToolHandler('git_log', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const gitArgs = ['log', `--max-count=${String(args.maxCount)}`];
      if (args.oneline) gitArgs.push('--oneline');
      if (args.branch) gitArgs.push(args.branch);
      const { stdout, stderr } = await exec('git', gitArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'git_diff',
    {
      description: 'Show changes in the working tree or between commits',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        staged: z.boolean().default(false).describe('Show staged changes (--cached)'),
        ref: z
          .string()
          .optional()
          .describe('Ref or range to diff (e.g. "HEAD~3", "main..feature")'),
        path: z.string().optional().describe('Restrict diff to a specific file or directory'),
        stat: z.boolean().default(false).describe('Show diffstat instead of full diff'),
      },
    },
    wrapToolHandler('git_diff', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const gitArgs = ['diff'];
      if (args.staged) gitArgs.push('--cached');
      if (args.stat) gitArgs.push('--stat');
      if (args.ref) gitArgs.push(args.ref);
      if (args.path) {
        gitArgs.push('--');
        gitArgs.push(args.path);
      }
      const { stdout, stderr } = await exec('git', gitArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'git_branch_list',
    {
      description: 'List branches in the repository',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        all: z.boolean().default(false).describe('Include remote-tracking branches'),
      },
    },
    wrapToolHandler('git_branch_list', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const gitArgs = ['branch', '-v'];
      if (args.all) gitArgs.push('-a');
      const { stdout, stderr } = await exec('git', gitArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'git_commit',
    {
      description: 'Stage files and create a commit',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        message: z.string().min(1).describe('Commit message'),
        files: z
          .array(z.string())
          .default([])
          .describe('Files to stage (empty = use current staging area)'),
        all: z.boolean().default(false).describe('Stage all modified/deleted tracked files (-a)'),
      },
    },
    wrapToolHandler('git_commit', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const results: string[] = [];

      // Stage specific files if provided
      if (args.files.length > 0) {
        const { stdout, stderr } = await exec('git', ['add', ...args.files], cwd);
        if (stdout.trim() || stderr.trim()) results.push(formatResult(stdout, stderr));
      }

      // Commit
      const commitArgs = ['commit', '-m', args.message];
      if (args.all) commitArgs.push('-a');
      const { stdout, stderr } = await exec('git', commitArgs, cwd);
      results.push(formatResult(stdout, stderr));

      return { content: [{ type: 'text' as const, text: results.join('\n\n') }] };
    })
  );

  server.registerTool(
    'git_checkout',
    {
      description: 'Switch branches or restore working tree files',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        ref: z.string().describe('Branch name, tag, or commit to check out'),
        create: z.boolean().default(false).describe('Create a new branch (-b)'),
      },
    },
    wrapToolHandler('git_checkout', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const gitArgs = ['checkout'];
      if (args.create) gitArgs.push('-b');
      gitArgs.push(args.ref);
      const { stdout, stderr } = await exec('git', gitArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'git_show',
    {
      description: 'Show details of a commit, tag, or other object',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        ref: z.string().default('HEAD').describe('Commit, tag, or object to show'),
        stat: z.boolean().default(false).describe('Show diffstat only'),
      },
    },
    wrapToolHandler('git_show', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const gitArgs = ['show'];
      if (args.stat) gitArgs.push('--stat');
      gitArgs.push(args.ref);
      const { stdout, stderr } = await exec('git', gitArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  // -- GitHub CLI Tools --

  server.registerTool(
    'github_pr_list',
    {
      description: 'List pull requests in the current GitHub repository',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        state: z
          .enum(['open', 'closed', 'merged', 'all'])
          .default('open')
          .describe('PR state filter'),
        limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
        author: z.string().optional().describe('Filter by author'),
        label: z.string().optional().describe('Filter by label'),
      },
    },
    wrapToolHandler('github_pr_list', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const ghArgs = ['pr', 'list', '--state', args.state, '--limit', String(args.limit)];
      if (args.author) ghArgs.push('--author', args.author);
      if (args.label) ghArgs.push('--label', args.label);
      const { stdout, stderr } = await exec('gh', ghArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'github_pr_view',
    {
      description: 'View details of a pull request',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        number: z.number().int().positive().describe('PR number'),
        comments: z.boolean().default(false).describe('Include comments'),
      },
    },
    wrapToolHandler('github_pr_view', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const ghArgs = ['pr', 'view', String(args.number)];
      if (args.comments) ghArgs.push('--comments');
      const { stdout, stderr } = await exec('gh', ghArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'github_pr_create',
    {
      description: 'Create a pull request',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        title: z.string().min(1).describe('PR title'),
        body: z.string().default('').describe('PR body/description'),
        base: z.string().optional().describe('Base branch (defaults to repo default)'),
        draft: z.boolean().default(false).describe('Create as draft PR'),
        label: z.array(z.string()).default([]).describe('Labels to add'),
      },
    },
    wrapToolHandler('github_pr_create', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const ghArgs = ['pr', 'create', '--title', args.title, '--body', args.body];
      if (args.base) ghArgs.push('--base', args.base);
      if (args.draft) ghArgs.push('--draft');
      for (const label of args.label) {
        ghArgs.push('--label', label);
      }
      const { stdout, stderr } = await exec('gh', ghArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'github_pr_diff',
    {
      description: 'View the diff of a pull request',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        number: z.number().int().positive().describe('PR number'),
      },
    },
    wrapToolHandler('github_pr_diff', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const ghArgs = ['pr', 'diff', String(args.number)];
      const { stdout, stderr } = await exec('gh', ghArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'github_issue_list',
    {
      description: 'List issues in the current GitHub repository',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        state: z.enum(['open', 'closed', 'all']).default('open').describe('Issue state filter'),
        limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
        assignee: z.string().optional().describe('Filter by assignee'),
        label: z.string().optional().describe('Filter by label'),
      },
    },
    wrapToolHandler('github_issue_list', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const ghArgs = ['issue', 'list', '--state', args.state, '--limit', String(args.limit)];
      if (args.assignee) ghArgs.push('--assignee', args.assignee);
      if (args.label) ghArgs.push('--label', args.label);
      const { stdout, stderr } = await exec('gh', ghArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'github_issue_view',
    {
      description: 'View details of an issue',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        number: z.number().int().positive().describe('Issue number'),
        comments: z.boolean().default(false).describe('Include comments'),
      },
    },
    wrapToolHandler('github_issue_view', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const ghArgs = ['issue', 'view', String(args.number)];
      if (args.comments) ghArgs.push('--comments');
      const { stdout, stderr } = await exec('gh', ghArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'github_issue_create',
    {
      description: 'Create a new issue',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
        title: z.string().min(1).describe('Issue title'),
        body: z.string().default('').describe('Issue body'),
        label: z.array(z.string()).default([]).describe('Labels to add'),
        assignee: z.array(z.string()).default([]).describe('Assignees'),
      },
    },
    wrapToolHandler('github_issue_create', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const ghArgs = ['issue', 'create', '--title', args.title, '--body', args.body];
      for (const label of args.label) {
        ghArgs.push('--label', label);
      }
      for (const assignee of args.assignee) {
        ghArgs.push('--assignee', assignee);
      }
      const { stdout, stderr } = await exec('gh', ghArgs, cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );

  server.registerTool(
    'github_repo_view',
    {
      description: 'View repository information',
      inputSchema: {
        cwd: z.string().describe('Path to the git repository'),
      },
    },
    wrapToolHandler('github_repo_view', middleware, async (args) => {
      const cwd = validateCwd(args.cwd, config);
      const { stdout, stderr } = await exec('gh', ['repo', 'view'], cwd);
      return { content: [{ type: 'text' as const, text: formatResult(stdout, stderr) }] };
    })
  );
}
