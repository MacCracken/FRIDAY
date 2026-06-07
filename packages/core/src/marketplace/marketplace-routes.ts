/**
 * Marketplace Routes — REST API for skill marketplace
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Config } from '@secureyeoman/shared';
import type { MarketplaceManager } from './manager.js';
import { toErrorMessage, sendError } from '../utils/errors.js';
import { parsePagination } from '../utils/pagination.js';
import { readCommunityPersonalities } from './community-personalities.js';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

export interface MarketplaceRoutesOptions {
  marketplaceManager: MarketplaceManager;
  getConfig?: () => Config;
  /** Called before community sync to lazy-boot delegation managers (workflow/swarm). */
  ensureDelegationReady?: () => Promise<void>;
  /** SoulManager for installing community personalities into local DB. */
  getSoulManager?: () => { createPersonality: (data: any) => Promise<any> } | null;
}

export function registerMarketplaceRoutes(
  app: FastifyInstance,
  opts: MarketplaceRoutesOptions
): void {
  const { marketplaceManager } = opts;

  app.get(
    '/api/v1/marketplace',
    async (
      request: FastifyRequest<{
        Querystring: {
          query?: string;
          category?: string;
          limit?: string;
          offset?: string;
          source?: string;
          /** origin is the preferred discriminator: 'marketplace' or 'community'.
           *  Translated to the storage-level `source` filter. Overrides `source` when set. */
          origin?: string;
          personalityId?: string;
        };
      }>
    ) => {
      const q = request.query;
      // Translate `origin` to the storage source filter. `origin` takes precedence over `source`.
      let effectiveSource = q.source;
      if (q.origin === 'community') {
        effectiveSource = 'community';
      } else if (q.origin === 'marketplace') {
        // Storage treats source='marketplace' as NOT community (builtin + published)
        effectiveSource = 'marketplace';
      }
      const { limit, offset } = parsePagination(q);
      return await marketplaceManager.search(
        q.query,
        q.category,
        limit,
        offset,
        effectiveSource,
        q.personalityId // undefined when not provided → stored boolean fallback
      );
    }
  );

  app.get(
    '/api/v1/marketplace/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const skill = await marketplaceManager.getSkill(request.params.id);
      if (!skill) return sendError(reply, 404, 'Skill not found');
      return { skill };
    }
  );

  app.post(
    '/api/v1/marketplace/:id/install',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { personalityId?: string } }>,
      reply: FastifyReply
    ) => {
      const personalityId = request.body?.personalityId || undefined;
      if (!(await marketplaceManager.install(request.params.id, personalityId)))
        return sendError(reply, 404, 'Skill not found');
      return { message: 'Skill installed' };
    }
  );

  app.post(
    '/api/v1/marketplace/:id/uninstall',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { personalityId?: string } }>,
      reply: FastifyReply
    ) => {
      const personalityId = request.body?.personalityId || undefined;
      if (!(await marketplaceManager.uninstall(request.params.id, personalityId)))
        return sendError(reply, 404, 'Skill not found');
      return { message: 'Skill uninstalled' };
    }
  );

  app.post(
    '/api/v1/marketplace/publish',
    async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
      try {
        const skill = await marketplaceManager.publish(request.body);
        return reply.code(201).send({ skill });
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.delete(
    '/api/v1/marketplace/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const skill = await marketplaceManager.getSkill(request.params.id);
      if (!skill) return sendError(reply, 404, 'Skill not found');
      if (skill.source === 'builtin')
        return sendError(reply, 403, 'Builtin skills cannot be deleted');
      if (!(await marketplaceManager.delete(request.params.id)))
        return sendError(reply, 404, 'Skill not found');
      return reply.code(204).send();
    }
  );

  // Community sync — accepts optional repoUrl when allowCommunityGitFetch policy is enabled.
  app.post(
    '/api/v1/marketplace/community/sync',
    async (request: FastifyRequest<{ Body?: { repoUrl?: string } }>, reply: FastifyReply) => {
      const repoUrl = request.body?.repoUrl;
      if (repoUrl && opts.getConfig && !opts.getConfig().security.allowCommunityGitFetch) {
        return sendError(reply, 403, 'Community git fetch is disabled by security policy');
      }
      try {
        if (opts.ensureDelegationReady) {
          await opts.ensureDelegationReady();
        }
        const result = await marketplaceManager.syncFromCommunity(undefined, repoUrl);
        return result;
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );

  app.get('/api/v1/marketplace/community/personalities', async (_request, reply: FastifyReply) => {
    try {
      const config = opts.getConfig?.();
      const repoPath =
        config?.security.communityRepoPath ??
        process.env.COMMUNITY_REPO_PATH ??
        '../secureyeoman-community-repo';
      const personalities = await readCommunityPersonalities(repoPath);
      return { personalities };
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // Install a community personality into the local database
  app.post(
    '/api/v1/marketplace/community/personalities/install',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { filename } = request.body as { filename?: string };
      if (!filename) return sendError(reply, 400, 'filename is required');

      // Prevent path traversal
      if (filename.includes('..') || filename.startsWith('/')) {
        return sendError(reply, 400, 'Invalid filename');
      }

      const soulManager = opts.getSoulManager?.();
      if (!soulManager) return sendError(reply, 503, 'Soul manager not available');

      try {
        const config = opts.getConfig?.();
        const repoPath =
          config?.security.communityRepoPath ??
          process.env.COMMUNITY_REPO_PATH ??
          '../secureyeoman-community-repo';

        // Read and parse the personality file
        const personalities = await readCommunityPersonalities(repoPath);
        const personality = personalities.find((p) => p.filename === filename);
        if (!personality) return sendError(reply, 404, 'Community personality not found');

        // Create in local DB
        const created = await soulManager.createPersonality({
          name: personality.name,
          description: `[community:${personality.category}] ${personality.description}`,
          systemPrompt: personality.systemPrompt,
          traits: personality.traits,
          sex: personality.sex ?? 'unspecified',
          voice: '',
          preferredLanguage: '',
          defaultModel: null,
          includeArchetypes: false,
        });

        return reply.code(201).send({ personality: created });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );

  // Serve community personality avatar files
  app.get(
    '/api/v1/marketplace/community/personalities/avatar/:path',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { path: avatarPath } = request.params as { path: string };
      if (!avatarPath || avatarPath.includes('..')) {
        return sendError(reply, 400, 'Invalid path');
      }

      try {
        const config = opts.getConfig?.();
        const repoPath =
          config?.security.communityRepoPath ??
          process.env.COMMUNITY_REPO_PATH ??
          '../secureyeoman-community-repo';

        const fullPath = join(repoPath, 'personalities', avatarPath);
        const data = await readFile(fullPath);
        const ext = extname(avatarPath).toLowerCase();
        const contentType =
          ext === '.svg'
            ? 'image/svg+xml'
            : ext === '.png'
              ? 'image/png'
              : ext === '.webp'
                ? 'image/webp'
                : ext === '.jpg' || ext === '.jpeg'
                  ? 'image/jpeg'
                  : 'application/octet-stream';

        return reply
          .header('Content-Type', contentType)
          .header('Cache-Control', 'public, max-age=86400')
          .send(data);
      } catch {
        return sendError(reply, 404, 'Avatar not found');
      }
    }
  );

  app.get('/api/v1/marketplace/community/status', async (_request, reply: FastifyReply) => {
    try {
      const status = await marketplaceManager.getCommunityStatus();
      return status;
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });
}
