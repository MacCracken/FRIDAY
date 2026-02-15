/**
 * AutoRegistration — registers this MCP server with core's McpStorage on boot.
 */

import type { CoreApiClient } from '../core-client.js';
import type { McpServiceConfig } from '@friday/shared';
import { getToolManifest } from '../tools/manifest.js';

export interface RegisteredServer {
  id: string;
}

export class AutoRegistration {
  private readonly client: CoreApiClient;
  private readonly config: McpServiceConfig;
  private registeredId: string | null = null;

  constructor(client: CoreApiClient, config: McpServiceConfig) {
    this.client = client;
    this.config = config;
  }

  async register(): Promise<string | null> {
    if (!this.config.autoRegister) {
      return null;
    }

    try {
      const toolManifest = getToolManifest();

      const result = await this.client.post<{ server: RegisteredServer }>('/api/v1/mcp/servers', {
        name: 'YEOMAN MCP',
        description: 'Built-in MCP server exposing YEOMAN tools, resources, and prompts',
        transport: this.config.transport,
        url: `http://${this.config.host}:${this.config.port}`,
        enabled: true,
        tools: toolManifest,
      });

      this.registeredId = result.server.id;
      return this.registeredId;
    } catch (err) {
      // Registration is best-effort — don't crash the service
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Auto-registration failed: ${msg}`);
    }
  }

  async deregister(): Promise<boolean> {
    if (!this.registeredId) {
      return false;
    }

    try {
      await this.client.delete(`/api/v1/mcp/servers/${this.registeredId}`);
      this.registeredId = null;
      return true;
    } catch {
      return false;
    }
  }

  getRegisteredId(): string | null {
    return this.registeredId;
  }
}
