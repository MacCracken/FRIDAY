/**
 * Tool Registry — registers all MCP tools.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CoreApiClient } from '../core-client.js';
import type { McpServiceConfig } from '@friday/shared';
import type { RateLimiterMiddleware } from '../middleware/rate-limiter.js';
import type { InputValidatorMiddleware } from '../middleware/input-validator.js';
import type { AuditLoggerMiddleware } from '../middleware/audit-logger.js';
import type { SecretRedactorMiddleware } from '../middleware/secret-redactor.js';
import { registerBrainTools } from './brain-tools.js';
import { registerTaskTools } from './task-tools.js';
import { registerSystemTools } from './system-tools.js';
import { registerIntegrationTools } from './integration-tools.js';
import { registerSoulTools } from './soul-tools.js';
import { registerAuditTools } from './audit-tools.js';
import { registerFilesystemTools } from './filesystem-tools.js';
import { registerGitTools } from './git-tools.js';

export interface ToolMiddleware {
  rateLimiter: RateLimiterMiddleware;
  inputValidator: InputValidatorMiddleware;
  auditLogger: AuditLoggerMiddleware;
  secretRedactor: SecretRedactorMiddleware;
}

export function registerAllTools(
  server: McpServer,
  client: CoreApiClient,
  config: McpServiceConfig,
  middleware: ToolMiddleware,
): void {
  registerBrainTools(server, client, middleware);
  registerTaskTools(server, client, middleware);
  registerSystemTools(server, client, config, middleware);
  registerIntegrationTools(server, client, middleware);
  registerSoulTools(server, client, middleware);
  registerAuditTools(server, client, middleware);

  // Git & filesystem tools are always registered at the MCP protocol level.
  // Feature toggles (exposeGit, exposeFilesystem) control visibility in the
  // core API response, not whether the tools exist on the MCP server.
  registerGitTools(server, config, middleware);
  registerFilesystemTools(server, config, middleware);
}
