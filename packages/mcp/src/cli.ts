#!/usr/bin/env node

/**
 * CLI entry point for the FRIDAY MCP service.
 */

import { loadConfig } from './config/config.js';
import { McpServiceServer } from './server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CoreApiClient } from './core-client.js';
import { mintServiceToken } from './auth/service-token.js';
import { registerAllTools } from './tools/index.js';
import { registerAllResources } from './resources/index.js';
import { registerAllPrompts } from './prompts/index.js';
import { createRateLimiter } from './middleware/rate-limiter.js';
import { createInputValidator } from './middleware/input-validator.js';
import { createAuditLogger } from './middleware/audit-logger.js';
import { createSecretRedactor } from './middleware/secret-redactor.js';

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.enabled) {
    console.log('[friday-mcp] MCP service is disabled (MCP_ENABLED=false)');
    process.exit(0);
  }

  // stdio transport mode — no HTTP server needed
  if (config.transport === 'stdio') {
    if (!config.tokenSecret) {
      console.error('[friday-mcp] SECUREYEOMAN_TOKEN_SECRET is required');
      process.exit(1);
    }

    const coreToken = await mintServiceToken(config.tokenSecret);
    const coreClient = new CoreApiClient({
      coreUrl: config.coreUrl,
      coreToken,
    });

    const mcpServer = new McpServer({
      name: 'friday-mcp',
      version: '1.5.0',
    });

    const rateLimiter = createRateLimiter(config.rateLimitPerTool);
    const inputValidator = createInputValidator();
    const auditLogger = createAuditLogger(coreClient);
    const secretRedactor = createSecretRedactor();

    registerAllTools(mcpServer, coreClient, config, {
      rateLimiter,
      inputValidator,
      auditLogger,
      secretRedactor,
    });
    registerAllResources(mcpServer, coreClient);
    registerAllPrompts(mcpServer, coreClient);

    const transport = new StdioServerTransport();
    await mcpServer.server.connect(transport);
    console.error('[friday-mcp] stdio transport started');
    return;
  }

  // HTTP-based transport modes (streamable-http, sse)
  if (!config.tokenSecret) {
    console.error('[friday-mcp] SECUREYEOMAN_TOKEN_SECRET is required');
    process.exit(1);
  }

  const coreToken = await mintServiceToken(config.tokenSecret);
  const coreClient = new CoreApiClient({
    coreUrl: config.coreUrl,
    coreToken,
  });
  const server = new McpServiceServer({ config, coreClient });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[friday-mcp] ${signal} received, shutting down...`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await server.start();
    console.log(`[friday-mcp] MCP service started on ${config.host}:${config.port} (${config.transport})`);
  } catch (err) {
    console.error('[friday-mcp] Failed to start:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[friday-mcp] Fatal:', err);
  process.exit(1);
});
