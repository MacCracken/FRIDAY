/**
 * Dashboard Routes — JSON API endpoints for the MCP dashboard.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ProxyAuth } from '../auth/proxy-auth.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerDashboardRoutes(
  app: FastifyInstance,
  auth: ProxyAuth,
  mcpServer: McpServer,
): void {
  // Auth middleware for dashboard routes
  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = auth.extractToken(request.headers.authorization);
    if (!token) {
      reply.code(401).send({ error: 'Missing authentication credentials' });
      return;
    }
    const result = await auth.verify(token);
    if (!result.valid) {
      reply.code(401).send({ error: 'Invalid or expired token' });
      return;
    }
  }

  app.addHook('onRequest', async (request, reply) => {
    // Only apply auth to dashboard routes (not /health, /mcp/v1)
    if (request.url.startsWith('/dashboard')) {
      await requireAuth(request, reply);
    }
  });

  app.get('/dashboard', async () => {
    return {
      service: 'friday-mcp',
      version: '1.5.1',
      status: 'running',
      tools: listMcpCapabilities(mcpServer, 'tools'),
      resources: listMcpCapabilities(mcpServer, 'resources'),
      prompts: listMcpCapabilities(mcpServer, 'prompts'),
    };
  });

  app.get('/dashboard/tools', async () => {
    return { tools: listMcpCapabilities(mcpServer, 'tools') };
  });

  app.get('/dashboard/resources', async () => {
    return { resources: listMcpCapabilities(mcpServer, 'resources') };
  });

  app.get('/dashboard/prompts', async () => {
    return { prompts: listMcpCapabilities(mcpServer, 'prompts') };
  });

  app.get('/dashboard/logs', async () => {
    // Return empty for now — audit logs fetched from core
    return { logs: [], total: 0 };
  });
}

function listMcpCapabilities(
  _mcpServer: McpServer,
  _type: 'tools' | 'resources' | 'prompts',
): { count: number } {
  // The MCP SDK doesn't expose registered tools/resources/prompts directly
  // We track them in our registration functions instead
  return { count: 0 };
}
