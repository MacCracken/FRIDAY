import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpStorage } from './storage.js';
import { McpClientManager } from './client.js';
import { McpServer } from './server.js';
import { createNoopLogger } from '../logging/logger.js';
import { existsSync, unlinkSync } from 'node:fs';

const TEST_DB = '/tmp/mcp-test.db';

describe('McpStorage', () => {
  let storage: McpStorage;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    storage = new McpStorage({ dbPath: TEST_DB });
  });

  afterEach(() => {
    storage.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('should add and retrieve a server', () => {
    const server = storage.addServer({
      name: 'Test Server',
      transport: 'stdio',
      command: '/usr/bin/test-mcp',
    });
    expect(server.id).toBeTruthy();
    expect(server.name).toBe('Test Server');

    const retrieved = storage.getServer(server.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.name).toBe('Test Server');
  });

  it('should list servers', () => {
    storage.addServer({ name: 'Server 1' });
    storage.addServer({ name: 'Server 2' });
    const servers = storage.listServers();
    expect(servers).toHaveLength(2);
  });

  it('should delete a server', () => {
    const server = storage.addServer({ name: 'To Delete' });
    expect(storage.deleteServer(server.id)).toBe(true);
    expect(storage.getServer(server.id)).toBeNull();
  });

  it('should return false for deleting non-existent server', () => {
    expect(storage.deleteServer('nonexistent')).toBe(false);
  });

  it('should update server enabled status', () => {
    const server = storage.addServer({ name: 'Toggle Me', enabled: true });
    expect(storage.getServer(server.id)!.enabled).toBe(true);

    expect(storage.updateServer(server.id, { enabled: false })).toBe(true);
    expect(storage.getServer(server.id)!.enabled).toBe(false);

    expect(storage.updateServer(server.id, { enabled: true })).toBe(true);
    expect(storage.getServer(server.id)!.enabled).toBe(true);
  });

  it('should return false for updating non-existent server', () => {
    expect(storage.updateServer('nonexistent', { enabled: false })).toBe(false);
  });

  it('should return false for empty update', () => {
    const server = storage.addServer({ name: 'No Op' });
    expect(storage.updateServer(server.id, {})).toBe(false);
  });

  it('should save and load tools', () => {
    const server = storage.addServer({ name: 'With Tools', enabled: true });
    storage.saveTools(server.id, 'With Tools', [
      { name: 'tool_1', description: 'First tool', inputSchema: { type: 'object' } },
      { name: 'tool_2', description: 'Second tool' },
    ]);

    const tools = storage.loadTools(server.id);
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('tool_1');
    expect(tools[0].description).toBe('First tool');
    expect(tools[0].inputSchema).toEqual({ type: 'object' });
    expect(tools[0].serverId).toBe(server.id);
    expect(tools[0].serverName).toBe('With Tools');
    expect(tools[1].name).toBe('tool_2');
  });

  it('should replace tools on saveTools', () => {
    const server = storage.addServer({ name: 'Replace', enabled: true });
    storage.saveTools(server.id, 'Replace', [{ name: 'old_tool' }]);
    expect(storage.loadTools(server.id)).toHaveLength(1);

    storage.saveTools(server.id, 'Replace', [{ name: 'new_a' }, { name: 'new_b' }]);
    const tools = storage.loadTools(server.id);
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('new_a');
  });

  it('should delete tools', () => {
    const server = storage.addServer({ name: 'Delete Tools', enabled: true });
    storage.saveTools(server.id, 'Delete Tools', [{ name: 'doomed' }]);
    expect(storage.loadTools(server.id)).toHaveLength(1);

    storage.deleteTools(server.id);
    expect(storage.loadTools(server.id)).toHaveLength(0);
  });
});

describe('McpClientManager', () => {
  let storage: McpStorage;
  let client: McpClientManager;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    storage = new McpStorage({ dbPath: TEST_DB });
    client = new McpClientManager(storage, { logger: createNoopLogger() });
  });

  afterEach(() => {
    storage.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('should return empty tools for disabled server', async () => {
    const server = storage.addServer({ name: 'Disabled', enabled: false });
    const tools = await client.discoverTools(server.id);
    expect(tools).toEqual([]);
  });

  it('should get all tools across servers', () => {
    expect(client.getAllTools()).toEqual([]);
  });

  it('should register and retrieve tools from manifest', () => {
    const server = storage.addServer({ name: 'MCP Service', enabled: true });
    client.registerTools(server.id, 'MCP Service', [
      { name: 'knowledge_search', description: 'Search knowledge' },
      { name: 'task_list', description: 'List tasks' },
    ]);

    const tools = client.getAllTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('knowledge_search');
    expect(tools[0].serverId).toBe(server.id);
    expect(tools[0].serverName).toBe('MCP Service');
    expect(tools[1].name).toBe('task_list');
  });

  it('should clear in-memory tools but retain in DB', () => {
    const server = storage.addServer({ name: 'Clearable', enabled: true });
    client.registerTools(server.id, 'Clearable', [
      { name: 'tool_a', description: 'A' },
    ]);
    expect(client.getAllTools()).toHaveLength(1);

    client.clearTools(server.id);
    expect(client.getAllTools()).toHaveLength(0);

    // DB still has the tools
    const persisted = storage.loadTools(server.id);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].name).toBe('tool_a');
  });

  it('should permanently delete tools with deleteTools', () => {
    const server = storage.addServer({ name: 'Deletable', enabled: true });
    client.registerTools(server.id, 'Deletable', [
      { name: 'tool_b', description: 'B' },
    ]);
    expect(client.getAllTools()).toHaveLength(1);

    client.deleteTools(server.id);
    expect(client.getAllTools()).toHaveLength(0);
    expect(storage.loadTools(server.id)).toHaveLength(0);
  });

  it('should return pre-registered tools on discoverTools', async () => {
    const server = storage.addServer({ name: 'Pre-registered', enabled: true });
    client.registerTools(server.id, 'Pre-registered', [
      { name: 'tool_x', description: 'X' },
    ]);

    const tools = await client.discoverTools(server.id);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('tool_x');
  });

  it('should restore tools from DB after clear + rediscover', async () => {
    const server = storage.addServer({ name: 'Toggle Me', enabled: true });
    client.registerTools(server.id, 'Toggle Me', [
      { name: 'knowledge_search', description: 'Search' },
      { name: 'task_list', description: 'List tasks' },
    ]);
    expect(client.getAllTools()).toHaveLength(2);

    // Simulate disable: clear in-memory
    client.clearTools(server.id);
    expect(client.getAllTools()).toHaveLength(0);

    // Simulate enable: rediscover from DB
    const restored = await client.discoverTools(server.id);
    expect(restored).toHaveLength(2);
    expect(restored[0].name).toBe('knowledge_search');
    expect(client.getAllTools()).toHaveLength(2);
  });

  it('should restore tools after full toggle cycle (disable in DB then re-enable)', async () => {
    const server = storage.addServer({ name: 'Full Toggle', enabled: true });
    client.registerTools(server.id, 'Full Toggle', [
      { name: 'knowledge_search', description: 'Search' },
      { name: 'task_list', description: 'List tasks' },
    ]);
    expect(client.getAllTools()).toHaveLength(2);

    // Simulate PATCH { enabled: false } — exact route behavior
    storage.updateServer(server.id, { enabled: false });
    client.clearTools(server.id);
    expect(client.getAllTools()).toHaveLength(0);

    // Simulate PATCH { enabled: true } — exact route behavior using restoreTools
    storage.updateServer(server.id, { enabled: true });
    const restored = client.restoreTools(server.id);
    expect(restored).toHaveLength(2);
    expect(restored[0].name).toBe('knowledge_search');
    expect(restored[1].name).toBe('task_list');
    expect(client.getAllTools()).toHaveLength(2);
  });

  it('should restore tools via restoreTools even when server is still disabled in DB', () => {
    const server = storage.addServer({ name: 'Restore Test', enabled: true });
    client.registerTools(server.id, 'Restore Test', [
      { name: 'tool_a', description: 'A' },
    ]);

    // Disable in DB and clear memory
    storage.updateServer(server.id, { enabled: false });
    client.clearTools(server.id);
    expect(client.getAllTools()).toHaveLength(0);

    // restoreTools works regardless of enabled flag (caller controls timing)
    const restored = client.restoreTools(server.id);
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe('tool_a');
    expect(client.getAllTools()).toHaveLength(1);
  });

  it('should refresh all servers', async () => {
    storage.addServer({ name: 'Enabled Server', enabled: true });
    await client.refreshAll();
    // Should not throw
  });
});

describe('McpServer', () => {
  it('should expose tools and resources', () => {
    const server = new McpServer({ logger: createNoopLogger() });
    expect(server.getExposedTools()).toEqual([]);
    expect(server.getExposedResources()).toEqual([]);
  });

  it('should handle tool calls', async () => {
    const server = new McpServer({ logger: createNoopLogger() });
    const result = await server.handleToolCall('test_tool', { key: 'value' });
    expect(result).toBeTruthy();
  });
});
