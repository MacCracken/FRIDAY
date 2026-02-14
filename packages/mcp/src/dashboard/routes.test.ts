import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDashboardRoutes } from './routes.js';
import { ProxyAuth } from '../auth/proxy-auth.js';
import type { CoreApiClient } from '../core-client.js';

function mockClient(valid = true): CoreApiClient {
  return {
    post: vi.fn().mockResolvedValue({ valid, userId: 'admin', role: 'admin', permissions: [] }),
    get: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as CoreApiClient;
}

describe('dashboard routes', () => {
  let app: FastifyInstance;
  let mcpServer: McpServer;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    mcpServer = new McpServer({ name: 'test', version: '1.0.0' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('should reject GET /dashboard without auth', async () => {
    const auth = new ProxyAuth(mockClient());
    registerDashboardRoutes(app, auth, mcpServer);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(401);
  });

  it('should reject GET /dashboard with invalid token', async () => {
    const auth = new ProxyAuth(mockClient(false));
    registerDashboardRoutes(app, auth, mcpServer);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard',
      headers: { authorization: 'Bearer invalid' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should return server info on GET /dashboard with valid auth', async () => {
    const auth = new ProxyAuth(mockClient());
    registerDashboardRoutes(app, auth, mcpServer);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard',
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('friday-mcp');
    expect(res.json().version).toBe('1.5.0');
    expect(res.json().status).toBe('running');
  });

  it('should return tools on GET /dashboard/tools', async () => {
    const auth = new ProxyAuth(mockClient());
    registerDashboardRoutes(app, auth, mcpServer);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/tools',
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools).toBeDefined();
  });

  it('should return resources on GET /dashboard/resources', async () => {
    const auth = new ProxyAuth(mockClient());
    registerDashboardRoutes(app, auth, mcpServer);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/resources',
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().resources).toBeDefined();
  });

  it('should return prompts on GET /dashboard/prompts', async () => {
    const auth = new ProxyAuth(mockClient());
    registerDashboardRoutes(app, auth, mcpServer);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/prompts',
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().prompts).toBeDefined();
  });

  it('should return logs on GET /dashboard/logs', async () => {
    const auth = new ProxyAuth(mockClient());
    registerDashboardRoutes(app, auth, mcpServer);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/logs',
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().logs).toBeDefined();
    expect(res.json().total).toBe(0);
  });

  it('should require auth for all dashboard routes', async () => {
    const auth = new ProxyAuth(mockClient());
    registerDashboardRoutes(app, auth, mcpServer);
    await app.ready();

    const routes = ['/dashboard', '/dashboard/tools', '/dashboard/resources', '/dashboard/prompts', '/dashboard/logs'];
    for (const route of routes) {
      const res = await app.inject({ method: 'GET', url: route });
      expect(res.statusCode).toBe(401);
    }
  });

  it('should not require auth for non-dashboard routes', async () => {
    const auth = new ProxyAuth(mockClient());
    registerDashboardRoutes(app, auth, mcpServer);
    app.get('/health', async () => ({ status: 'ok' }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});
