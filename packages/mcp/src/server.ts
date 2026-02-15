/**
 * McpServiceServer — Fastify + MCP SDK server.
 *
 * Lifecycle: validate core → register tools/resources/prompts → auto-register → listen.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServiceConfig } from '@friday/shared';
import { CoreApiClient } from './core-client.js';
import { ProxyAuth } from './auth/proxy-auth.js';
import { AutoRegistration } from './registration/auto-register.js';
import { registerStreamableHttpTransport } from './transport/streamable-http.js';
import { registerSseTransport } from './transport/sse.js';
import { registerAllTools } from './tools/index.js';
import { registerAllResources } from './resources/index.js';
import { registerAllPrompts } from './prompts/index.js';
import { createRateLimiter } from './middleware/rate-limiter.js';
import { createInputValidator } from './middleware/input-validator.js';
import { createAuditLogger } from './middleware/audit-logger.js';
import { createSecretRedactor } from './middleware/secret-redactor.js';
import { registerDashboardRoutes } from './dashboard/routes.js';

export interface McpServiceServerOptions {
  config: McpServiceConfig;
  coreClient: CoreApiClient;
}

export class McpServiceServer {
  private readonly config: McpServiceConfig;
  private readonly app: FastifyInstance;
  private readonly coreClient: CoreApiClient;
  private readonly auth: ProxyAuth;
  private readonly autoReg: AutoRegistration;
  private readonly mcpServer: McpServer;

  constructor(opts: McpServiceServerOptions) {
    this.config = opts.config;
    this.coreClient = opts.coreClient;
    this.auth = new ProxyAuth(this.coreClient);
    this.autoReg = new AutoRegistration(this.coreClient, this.config);

    this.app = Fastify({
      logger: false,
      bodyLimit: 1_048_576,
    });

    this.mcpServer = new McpServer({
      name: 'friday-mcp',
      version: '1.5.1',
    });
  }

  async start(): Promise<void> {
    // 1. Validate core reachability
    const coreHealthy = await this.coreClient.healthCheck();
    if (!coreHealthy) {
      throw new Error(`Core service unreachable at ${this.config.coreUrl}`);
    }

    // 2. Set up middleware
    const rateLimiter = createRateLimiter(this.config.rateLimitPerTool);
    const inputValidator = createInputValidator();
    const auditLogger = createAuditLogger(this.coreClient);
    const secretRedactor = createSecretRedactor();

    // 3. Register tools, resources, prompts
    registerAllTools(this.mcpServer, this.coreClient, this.config, {
      rateLimiter,
      inputValidator,
      auditLogger,
      secretRedactor,
    });
    registerAllResources(this.mcpServer, this.coreClient);
    registerAllPrompts(this.mcpServer, this.coreClient);

    // 4. Register transports
    if (this.config.transport === 'streamable-http' || this.config.transport === 'sse') {
      registerStreamableHttpTransport({
        app: this.app,
        mcpServer: this.mcpServer,
        auth: this.auth,
      });
    }

    if (this.config.transport === 'sse') {
      registerSseTransport({
        app: this.app,
        mcpServer: this.mcpServer,
        auth: this.auth,
      });
    }

    // 5. Register dashboard routes
    registerDashboardRoutes(this.app, this.auth, this.mcpServer);

    // 6. Health endpoint
    this.app.get('/health', async () => ({
      status: 'ok',
      service: 'friday-mcp',
      version: '1.5.1',
      transport: this.config.transport,
    }));

    // 7. Auto-register with core
    if (this.config.autoRegister) {
      try {
        await this.autoReg.register();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Log but don't crash
        console.warn(`[friday-mcp] Auto-registration warning: ${msg}`);
      }
    }

    // 8. Start listening
    await this.app.listen({ host: this.config.host, port: this.config.port });
  }

  async stop(): Promise<void> {
    // Deregister from core
    await this.autoReg.deregister();
    // Close MCP server
    await this.mcpServer.server.close();
    // Close Fastify
    await this.app.close();
  }

  getApp(): FastifyInstance {
    return this.app;
  }

  getMcpServer(): McpServer {
    return this.mcpServer;
  }

  getCoreClient(): CoreApiClient {
    return this.coreClient;
  }

  getAuth(): ProxyAuth {
    return this.auth;
  }
}

export function createMcpServiceServer(opts: McpServiceServerOptions): McpServiceServer {
  return new McpServiceServer(opts);
}
