/**
 * Browser Automation Routes — REST API for browser session management.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BrowserSessionStorage } from './storage.js';
import { sendError } from '../utils/errors.js';
import { parsePagination } from '../utils/pagination.js';
import { licenseGuard } from '../licensing/license-guard.js';
import type { SecureYeoman } from '../secureyeoman.js';

export function registerBrowserRoutes(
  app: FastifyInstance,
  opts: {
    browserSessionStorage: BrowserSessionStorage;
    browserConfig: Record<string, unknown>;
    secureYeoman?: SecureYeoman;
  }
): void {
  const { browserSessionStorage, browserConfig, secureYeoman } = opts;

  const featureGuardOpts = licenseGuard('computer_use', secureYeoman);

  // List sessions
  app.get('/api/v1/browser/sessions', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const { limit, offset } = parsePagination(query);
    return browserSessionStorage.listSessions({
      status: query.status,
      toolName: query.toolName,
      limit,
      offset,
    });
  });

  // Get single session
  app.get(
    '/api/v1/browser/sessions/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      const session = await browserSessionStorage.getSession(id);
      if (!session) return sendError(reply, 404, 'Session not found');
      return session;
    }
  );

  // Close session
  app.post(
    '/api/v1/browser/sessions/:id/close',
    featureGuardOpts,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const { id } = request.params;
      const session = await browserSessionStorage.closeSession(id);
      if (!session) return sendError(reply, 404, 'Session not found');
      return session;
    }
  );

  // Get browser config
  app.get('/api/v1/browser/config', async () => {
    return browserConfig;
  });

  // Get session stats
  app.get('/api/v1/browser/sessions/stats', async () => {
    return browserSessionStorage.getSessionStats();
  });
}
