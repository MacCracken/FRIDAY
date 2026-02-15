import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { McpServiceServer } from '../server.js';
import { CoreApiClient } from '../core-client.js';
import type { McpServiceConfig } from '@friday/shared';

// Mock core server that simulates SecureYeoman's API
let mockCore: FastifyInstance;
let mcpServer: McpServiceServer;
let mockCoreUrl: string;

function makeConfig(overrides?: Partial<McpServiceConfig>): McpServiceConfig {
  return {
    enabled: true,
    port: 0, // OS-assigned
    host: '127.0.0.1',
    transport: 'streamable-http',
    autoRegister: false,
    coreUrl: mockCoreUrl,
    tokenSecret: 'a-test-token-secret-that-is-at-least-32-chars',
    exposeFilesystem: false,
    allowedPaths: [],
    rateLimitPerTool: 30,
    logLevel: 'info',
    ...overrides,
  };
}

beforeAll(async () => {
  // Start mock core server
  mockCore = Fastify({ logger: false });

  mockCore.get('/health', async () => ({ status: 'ok' }));

  mockCore.post('/api/v1/auth/verify', async (request) => {
    const body = request.body as { token?: string };
    if (body?.token === 'valid-user-token') {
      return { valid: true, userId: 'admin', role: 'admin', permissions: ['*'] };
    }
    return { valid: false };
  });

  mockCore.get('/api/v1/brain/knowledge', async () => ({
    entries: [{ id: '1', content: 'Test knowledge', type: 'fact' }],
  }));

  mockCore.get('/api/v1/tasks', async () => ({
    tasks: [{ id: '1', name: 'Test task', status: 'completed' }],
  }));

  mockCore.get('/api/v1/metrics', async () => ({
    uptime: 3600,
    tasksCompleted: 42,
  }));

  mockCore.get('/api/v1/audit', async () => ({
    entries: [{ event: 'test', level: 'info', message: 'Test event' }],
  }));

  mockCore.post('/api/v1/audit', async () => ({ message: 'Logged' }));

  mockCore.get('/api/v1/soul/personality', async () => ({
    personality: { id: '1', name: 'FRIDAY', systemPrompt: 'I am FRIDAY' },
  }));

  mockCore.get('/api/v1/integrations', async () => ({
    integrations: [],
  }));

  mockCore.post('/api/v1/mcp/servers', async () => ({
    server: { id: 'mcp-test-123' },
  }));

  mockCore.delete('/api/v1/mcp/servers/:id', async () => ({
    message: 'Removed',
  }));

  await mockCore.listen({ host: '127.0.0.1', port: 0 });
  const addr = mockCore.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  mockCoreUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (mcpServer) await mcpServer.stop();
  if (mockCore) await mockCore.close();
});

describe('e2e integration', () => {
  it('should start MCP service with mock core', async () => {
    const client = new CoreApiClient({ coreUrl: mockCoreUrl, coreToken: 'test-service-token' });
    mcpServer = new McpServiceServer({ config: makeConfig(), coreClient: client });
    await mcpServer.start();

    const res = await mcpServer.getApp().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('friday-mcp');
  });

  it('should reject unauthenticated MCP requests', async () => {
    const res = await mcpServer.getApp().inject({
      method: 'POST',
      url: '/mcp/v1',
      payload: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should reject invalid token on MCP requests', async () => {
    const res = await mcpServer.getApp().inject({
      method: 'POST',
      url: '/mcp/v1',
      headers: { authorization: 'Bearer invalid-token' },
      payload: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should require auth on dashboard routes', async () => {
    const res = await mcpServer.getApp().inject({
      method: 'GET',
      url: '/dashboard',
    });
    expect(res.statusCode).toBe(401);
  });

  it('should serve dashboard with valid auth', async () => {
    const res = await mcpServer.getApp().inject({
      method: 'GET',
      url: '/dashboard',
      headers: { authorization: 'Bearer valid-user-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('friday-mcp');
  });

  it('should serve dashboard tools with valid auth', async () => {
    const res = await mcpServer.getApp().inject({
      method: 'GET',
      url: '/dashboard/tools',
      headers: { authorization: 'Bearer valid-user-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools).toBeDefined();
  });

  it('should serve dashboard logs with valid auth', async () => {
    const res = await mcpServer.getApp().inject({
      method: 'GET',
      url: '/dashboard/logs',
      headers: { authorization: 'Bearer valid-user-token' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('should auto-register with core when enabled', async () => {
    const client = new CoreApiClient({ coreUrl: mockCoreUrl, coreToken: 'test-service-token' });
    const autoRegServer = new McpServiceServer({
      config: makeConfig({ autoRegister: true }),
      coreClient: client,
    });
    await autoRegServer.start();

    // Health check should work
    const res = await autoRegServer.getApp().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);

    await autoRegServer.stop();
  });

  it('health endpoint should include transport info', async () => {
    const res = await mcpServer.getApp().inject({ method: 'GET', url: '/health' });
    expect(res.json().transport).toBe('streamable-http');
    expect(res.json().version).toBe('1.5.1');
  });

  it('core client should be accessible from server', () => {
    expect(mcpServer.getCoreClient()).toBeDefined();
  });

  it('proxy auth should be accessible from server', () => {
    expect(mcpServer.getAuth()).toBeDefined();
  });

  it('MCP server should be accessible from server', () => {
    expect(mcpServer.getMcpServer()).toBeDefined();
  });

  it('should handle core healthcheck correctly', async () => {
    const client = new CoreApiClient({ coreUrl: mockCoreUrl, coreToken: 'test' });
    const healthy = await client.healthCheck();
    expect(healthy).toBe(true);
  });

  it('should detect unreachable core', async () => {
    const client = new CoreApiClient({ coreUrl: 'http://127.0.0.1:1', coreToken: 'test' });
    const healthy = await client.healthCheck();
    expect(healthy).toBe(false);
  });

  it('should stop cleanly', async () => {
    await mcpServer.stop();
    // Restart for any remaining tests
    const client = new CoreApiClient({ coreUrl: mockCoreUrl, coreToken: 'test-service-token' });
    mcpServer = new McpServiceServer({ config: makeConfig(), coreClient: client });
    await mcpServer.start();
  });
});
