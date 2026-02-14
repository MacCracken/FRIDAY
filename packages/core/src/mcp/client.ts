/**
 * MCP Client Manager — connects to external MCP servers, discovers tools
 */

import type { McpServerConfig, McpToolDef, McpResourceDef, McpToolManifest } from '@friday/shared';
import type { SecureLogger } from '../logging/logger.js';
import { McpStorage } from './storage.js';

export interface McpClientManagerDeps {
  logger: SecureLogger;
}

export class McpClientManager {
  private storage: McpStorage;
  private logger: SecureLogger;
  private discoveredTools = new Map<string, McpToolDef[]>();
  private discoveredResources = new Map<string, McpResourceDef[]>();

  constructor(storage: McpStorage, deps: McpClientManagerDeps) {
    this.storage = storage;
    this.logger = deps.logger;
  }

  /**
   * Register tools provided by an MCP server during auto-registration.
   * Persists tools to SQLite so they survive toggle cycles.
   */
  registerTools(serverId: string, serverName: string, tools: McpToolManifest[]): void {
    const mcpTools: McpToolDef[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? {},
      serverId,
      serverName,
    }));
    this.discoveredTools.set(serverId, mcpTools);
    this.storage.saveTools(serverId, serverName, tools);
    this.logger.info('Registered tools from MCP server', { serverId, serverName, count: mcpTools.length });
  }

  async discoverTools(serverId: string): Promise<McpToolDef[]> {
    const server = this.storage.getServer(serverId);
    if (!server || !server.enabled) return [];

    // If tools are already in memory, return those
    const existing = this.discoveredTools.get(serverId);
    if (existing && existing.length > 0) {
      return existing;
    }

    // Fall back to persisted tools (survives toggle off/on)
    const persisted = this.storage.loadTools(serverId);
    if (persisted.length > 0) {
      this.discoveredTools.set(serverId, persisted);
      this.logger.info('Restored tools from storage for MCP server', { serverId, count: persisted.length });
      return persisted;
    }

    this.logger.debug('No pre-registered tools for MCP server', { serverId });
    return [];
  }

  async discoverResources(serverId: string): Promise<McpResourceDef[]> {
    const server = this.storage.getServer(serverId);
    if (!server || !server.enabled) return [];

    const resources: McpResourceDef[] = [];
    this.discoveredResources.set(serverId, resources);
    this.logger.debug('Discovered resources from MCP server', { serverId, count: resources.length });
    return resources;
  }

  getAllTools(): McpToolDef[] {
    const allTools: McpToolDef[] = [];
    for (const tools of this.discoveredTools.values()) {
      allTools.push(...tools);
    }
    return allTools;
  }

  getAllResources(): McpResourceDef[] {
    const allResources: McpResourceDef[] = [];
    for (const resources of this.discoveredResources.values()) {
      allResources.push(...resources);
    }
    return allResources;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const server = this.storage.getServer(serverId);
    if (!server || !server.enabled) {
      throw new Error(`MCP server ${serverId} not found or disabled`);
    }

    this.logger.info('Calling MCP tool', { serverId, toolName });
    // In production, this would route through the MCP transport
    return { result: `Tool ${toolName} called with args`, args };
  }

  async refreshAll(): Promise<void> {
    const servers = this.storage.listServers();
    for (const server of servers) {
      if (server.enabled) {
        await this.discoverTools(server.id);
        await this.discoverResources(server.id);
      }
    }
  }

  /**
   * Clear in-memory tools for a server (e.g. on disable).
   * Persisted tools are retained so they can be restored on re-enable.
   */
  clearTools(serverId: string): void {
    this.discoveredTools.delete(serverId);
    this.discoveredResources.delete(serverId);
  }

  /**
   * Permanently delete tools for a server (e.g. on server removal).
   * Clears both in-memory cache and persistent storage.
   */
  deleteTools(serverId: string): void {
    this.discoveredTools.delete(serverId);
    this.discoveredResources.delete(serverId);
    this.storage.deleteTools(serverId);
  }
}
