/**
 * GitHubIntegration — GitHub adapter using Octokit + Webhooks.
 *
 * Handles push, pull_request, issues, and issue_comment events.
 * Normalizes inbound webhook payloads to UnifiedMessage with `gh_` prefix.
 * sendMessage() posts comments via the GitHub API.
 */

import { Octokit } from '@octokit/rest';
import { Webhooks } from '@octokit/webhooks';
import type { IntegrationConfig, UnifiedMessage, Platform } from '@friday/shared';
import type { WebhookIntegration, IntegrationDeps, PlatformRateLimit } from '../types.js';
import type { SecureLogger } from '../../logging/logger.js';

export class GitHubIntegration implements WebhookIntegration {
  readonly platform: Platform = 'github';
  readonly platformRateLimit: PlatformRateLimit = { maxPerSecond: 30 };

  private octokit: Octokit | null = null;
  private webhooks: Webhooks | null = null;
  private config: IntegrationConfig | null = null;
  private deps: IntegrationDeps | null = null;
  private logger: SecureLogger | null = null;
  private running = false;

  async init(config: IntegrationConfig, deps: IntegrationDeps): Promise<void> {
    this.config = config;
    this.deps = deps;
    this.logger = deps.logger;

    const token = config.config.personalAccessToken as string | undefined;
    if (!token) {
      throw new Error('GitHub integration requires a personalAccessToken in config');
    }

    const webhookSecret = config.config.webhookSecret as string | undefined;
    if (!webhookSecret) {
      throw new Error('GitHub integration requires a webhookSecret in config');
    }

    this.octokit = new Octokit({ auth: token });
    this.webhooks = new Webhooks({ secret: webhookSecret });

    // ── Push events ──────────────────────────────────────
    this.webhooks.on('push', ({ id, payload }) => {
      const repo = payload.repository;
      const unified: UnifiedMessage = {
        id: `gh_push_${id}`,
        integrationId: config.id,
        platform: 'github',
        direction: 'inbound',
        senderId: payload.sender?.login ?? '',
        senderName: payload.sender?.login ?? 'unknown',
        chatId: `${repo.owner?.login ?? ''}/${repo.name}`,
        text: `Push to ${payload.ref}: ${payload.commits?.map((c) => c.message).join(', ') ?? 'no commits'}`,
        attachments: [],
        platformMessageId: id,
        metadata: {
          event: 'push',
          ref: payload.ref,
          commitCount: payload.commits?.length ?? 0,
          headCommit: payload.head_commit?.id,
        },
        timestamp: Date.now(),
      };
      void this.deps!.onMessage(unified);
    });

    // ── Pull request events ──────────────────────────────
    this.webhooks.on('pull_request', ({ id, payload }) => {
      const pr = payload.pull_request;
      const repo = payload.repository;
      const unified: UnifiedMessage = {
        id: `gh_pr_${id}`,
        integrationId: config.id,
        platform: 'github',
        direction: 'inbound',
        senderId: payload.sender?.login ?? '',
        senderName: payload.sender?.login ?? 'unknown',
        chatId: `${repo.owner.login}/${repo.name}/pulls/${pr.number}`,
        text: `PR #${pr.number} ${payload.action}: ${pr.title}`,
        attachments: [],
        platformMessageId: String(pr.id),
        metadata: {
          event: 'pull_request',
          action: payload.action,
          prNumber: pr.number,
          prState: pr.state,
          prUrl: pr.html_url,
        },
        timestamp: Date.now(),
      };
      void this.deps!.onMessage(unified);
    });

    // ── Issues events ────────────────────────────────────
    this.webhooks.on('issues', ({ id, payload }) => {
      const issue = payload.issue;
      const repo = payload.repository;
      const unified: UnifiedMessage = {
        id: `gh_issue_${id}`,
        integrationId: config.id,
        platform: 'github',
        direction: 'inbound',
        senderId: payload.sender?.login ?? '',
        senderName: payload.sender?.login ?? 'unknown',
        chatId: `${repo.owner.login}/${repo.name}/issues/${issue.number}`,
        text: `Issue #${issue.number} ${payload.action}: ${issue.title}`,
        attachments: [],
        platformMessageId: String(issue.id),
        metadata: {
          event: 'issues',
          action: payload.action,
          issueNumber: issue.number,
          issueState: issue.state,
          issueUrl: issue.html_url,
        },
        timestamp: Date.now(),
      };
      void this.deps!.onMessage(unified);
    });

    // ── Issue comment events ─────────────────────────────
    this.webhooks.on('issue_comment', ({ id, payload }) => {
      const comment = payload.comment;
      const issue = payload.issue;
      const repo = payload.repository;
      const unified: UnifiedMessage = {
        id: `gh_comment_${id}`,
        integrationId: config.id,
        platform: 'github',
        direction: 'inbound',
        senderId: comment.user?.login ?? '',
        senderName: comment.user?.login ?? 'unknown',
        chatId: `${repo.owner.login}/${repo.name}/issues/${issue.number}`,
        text: comment.body ?? '',
        attachments: [],
        platformMessageId: String(comment.id),
        metadata: {
          event: 'issue_comment',
          action: payload.action,
          issueNumber: issue.number,
          commentUrl: comment.html_url,
        },
        timestamp: new Date(comment.created_at).getTime(),
      };
      void this.deps!.onMessage(unified);
    });

    this.logger?.info('GitHub integration initialized');
  }

  async start(): Promise<void> {
    if (!this.webhooks) throw new Error('Integration not initialized');
    if (this.running) return;
    this.running = true;
    this.logger?.info('GitHub integration started (webhook listener ready)');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.logger?.info('GitHub integration stopped');
  }

  /**
   * Send a message to GitHub by posting a comment.
   * chatId format: `owner/repo/issues/123` or `owner/repo/pulls/123`
   */
  async sendMessage(chatId: string, text: string, _metadata?: Record<string, unknown>): Promise<string> {
    if (!this.octokit) throw new Error('Integration not initialized');

    const parts = chatId.split('/');
    if (parts.length < 4) {
      throw new Error(`Invalid chatId format: expected "owner/repo/issues|pulls/number", got "${chatId}"`);
    }

    const owner = parts[0]!;
    const repo = parts[1]!;
    const numberStr = parts[3]!;
    const issueNumber = parseInt(numberStr, 10);
    if (isNaN(issueNumber)) {
      throw new Error(`Invalid issue/PR number in chatId: ${numberStr}`);
    }

    const result = await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: text,
    });

    return String(result.data.id);
  }

  isHealthy(): boolean {
    return this.running;
  }

  // ── WebhookIntegration methods ─────────────────────────

  getWebhookPath(): string {
    return `/api/v1/webhooks/github/${this.config?.id ?? 'unknown'}`;
  }

  verifyWebhook(payload: string, signature: string): boolean {
    if (!this.webhooks) return false;
    try {
      this.webhooks.verify(payload, signature);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Handle a raw webhook event. Called by the webhook route handler.
   */
  async handleWebhook(eventName: string, payload: string, signature: string): Promise<void> {
    if (!this.webhooks) throw new Error('Integration not initialized');

    await this.webhooks.verifyAndReceive({
      id: `wh_${Date.now()}`,
      name: eventName as any,
      payload,
      signature,
    });
  }

  getWebhooksInstance(): Webhooks | null {
    return this.webhooks;
  }
}
