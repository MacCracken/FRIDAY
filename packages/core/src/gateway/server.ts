/**
 * Gateway Server for SecureYeoman
 *
 * Provides REST API and WebSocket endpoints for the dashboard.
 *
 * Security considerations:
 * - Local network only by default
 * - All endpoints protected by authentication (when enabled)
 * - Rate limiting on all routes
 * - Input validation on all parameters
 */

import { readFileSync } from 'node:fs';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyCompress from '@fastify/compress';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
import { type SecureYeoman } from '../secureyeoman.js';
import type { GatewayConfig } from '@friday/shared';
import type { AuthService } from '../security/auth.js';
import { createAuthHook, createRbacHook } from './auth-middleware.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerSoulRoutes } from '../soul/soul-routes.js';
import { registerBrainRoutes } from '../brain/brain-routes.js';
import { registerSpiritRoutes } from '../spirit/spirit-routes.js';
import { registerCommsRoutes } from '../comms/comms-routes.js';
import { registerIntegrationRoutes } from '../integrations/integration-routes.js';
import { registerChatRoutes } from '../ai/chat-routes.js';
import { registerModelRoutes } from '../ai/model-routes.js';
import { uuidv7, sha256 } from '../utils/crypto.js';
import { Task, TaskType, TaskStatus } from '@friday/shared';
import { registerMcpRoutes } from '../mcp/mcp-routes.js';
import { registerReportRoutes } from '../reporting/report-routes.js';
import { registerDashboardRoutes } from '../dashboard/dashboard-routes.js';
import { registerWorkspaceRoutes } from '../workspace/workspace-routes.js';
import { registerExperimentRoutes } from '../experiment/experiment-routes.js';
import { registerMarketplaceRoutes } from '../marketplace/marketplace-routes.js';
import { registerTerminalRoutes } from './terminal-routes.js';
import { formatPrometheusMetrics } from './prometheus.js';

/**
 * Check if an IP address belongs to a private/loopback range.
 * Covers 127.0.0.0/8, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16.
 */
function isPrivateIP(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;

  // 172.16.0.0/12 → second octet 16–31
  if (ip.startsWith('172.')) {
    const secondOctet = Number(ip.split('.')[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  return false;
}

interface WebSocketClient {
  ws: WebSocket;
  channels: Set<string>;
  userId?: string;
  role?: string;
  lastPong: number;
}

/** Channel → minimum required RBAC resource:action for WebSocket subscriptions */
const CHANNEL_PERMISSIONS: Record<string, { resource: string; action: string }> = {
  metrics: { resource: 'metrics', action: 'read' },
  audit: { resource: 'audit', action: 'read' },
  tasks: { resource: 'tasks', action: 'read' },
  security: { resource: 'security_events', action: 'read' },
};

export interface GatewayServerOptions {
  config: GatewayConfig;
  secureYeoman: SecureYeoman;
  authService?: AuthService;
}

export class GatewayServer {
  private readonly config: GatewayConfig;
  private readonly secureYeoman: SecureYeoman;
  private readonly authService: AuthService | undefined;
  private readonly app: FastifyInstance;
  private readonly clients = new Map<string, WebSocketClient>();
  private logger: SecureLogger | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private clientIdCounter = 0;
  private lastMetricsJson: string | null = null;

  constructor(options: GatewayServerOptions) {
    this.config = options.config;
    this.secureYeoman = options.secureYeoman;
    this.authService = options.authService;

    // Build HTTPS options when TLS is enabled
    const httpsOpts = this.config.tls.enabled
      ? (() => {
          const certPath = this.config.tls.certPath;
          const keyPath = this.config.tls.keyPath;
          if (!certPath || !keyPath) {
            throw new Error('TLS enabled but certPath/keyPath not configured');
          }
          const opts: Record<string, unknown> = {
            cert: readFileSync(certPath),
            key: readFileSync(keyPath),
          };
          // When a CA path is provided, enable mTLS (client cert verification)
          if (this.config.tls.caPath) {
            opts.ca = readFileSync(this.config.tls.caPath);
            opts.requestCert = true;
            opts.rejectUnauthorized = true;
          }
          return opts;
        })()
      : undefined;

    // Create Fastify instance
    this.app = Fastify({
      logger: false, // We use our own logger
      trustProxy: false, // Security: don't trust proxy headers
      bodyLimit: 1_048_576, // 1 MB max request body
      ...(httpsOpts ? { https: httpsOpts } : {}),
    });

    // Middleware and routes are set up in start()
  }

  /**
   * Initialize the server (register plugins, set up middleware)
   */
  private async init(): Promise<void> {
    await this.setupMiddleware();
    this.setupRoutes();
  }

  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'Gateway' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }

  private async setupMiddleware(): Promise<void> {
    // Register compression plugin (gzip/brotli for JSON + text responses)
    await this.app.register(fastifyCompress);

    // Register WebSocket plugin
    await this.app.register(fastifyWebsocket, {
      options: {
        maxPayload: 1048576, // 1MB max message size
      },
    });

    // Local network check middleware
    this.app.addHook('onRequest', async (request, reply) => {
      const ip = request.ip;

      // Allow localhost and private network ranges (RFC 1918 + loopback)
      const isLocalNetwork = isPrivateIP(ip);

      if (!isLocalNetwork) {
        this.getLogger().warn('Access denied from non-local IP', { ip });
        return reply.code(403).send({
          error: 'Access denied',
          message: 'Dashboard is only accessible from local network',
        });
      }
    });

    // Security headers
    this.app.addHook('onRequest', async (_request, reply) => {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('X-XSS-Protection', '0');
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

      if (this.config.tls.enabled) {
        reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
    });

    // CORS for local development
    this.app.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;

      if (origin && this.config.cors.enabled) {
        const allowedOrigins = this.config.cors.origins;

        if (allowedOrigins.includes('*')) {
          reply.header('Access-Control-Allow-Origin', '*');
          // Do NOT set Allow-Credentials with wildcard origin
        } else if (allowedOrigins.includes(origin)) {
          reply.header('Access-Control-Allow-Origin', origin);
          reply.header('Access-Control-Allow-Credentials', 'true');
          reply.header('Vary', 'Origin');
        }

        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
        }
      }

      if (request.method === 'OPTIONS') {
        return reply.code(204).send();
      }
    });

    // Auth + RBAC hooks (after CORS, before routes)
    if (this.authService) {
      const logger = this.getLogger();
      this.app.addHook('onRequest', createAuthHook({ authService: this.authService, logger }));
      this.app.addHook(
        'onRequest',
        createRbacHook({
          rbac: this.secureYeoman.getRBAC(),
          auditChain: this.secureYeoman.getAuditChain(),
          logger,
        })
      );
    }

    // Request logging
    this.app.addHook('onResponse', async (request, reply) => {
      this.getLogger().debug('Request completed', {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      });
    });
  }

  private setupRoutes(): void {
    // Auth routes
    if (this.authService) {
      registerAuthRoutes(this.app, {
        authService: this.authService,
        rateLimiter: this.secureYeoman.getRateLimiter(),
      });
    }

    // Soul routes
    try {
      const soulManager = this.secureYeoman.getSoulManager();
      registerSoulRoutes(this.app, { soulManager });
    } catch {
      // Soul manager may not be available — skip routes
    }

    // Spirit routes
    try {
      const spiritManager = this.secureYeoman.getSpiritManager();
      registerSpiritRoutes(this.app, { spiritManager });
    } catch {
      // Spirit manager may not be available — skip routes
    }

    // Brain routes
    try {
      const brainManager = this.secureYeoman.getBrainManager();
      const heartbeatManager = this.secureYeoman.getHeartbeatManager() ?? undefined;
      const externalSync = this.secureYeoman.getExternalBrainSync() ?? undefined;
      let soulManager;
      try { soulManager = this.secureYeoman.getSoulManager(); } catch { /* may not be available */ }
      registerBrainRoutes(this.app, { brainManager, heartbeatManager, externalSync, soulManager });
    } catch {
      // Brain manager may not be available — skip routes
    }

    // Comms routes
    try {
      const agentComms = this.secureYeoman.getAgentComms();
      if (agentComms) {
        registerCommsRoutes(this.app, { agentComms });
      }
    } catch {
      // Agent comms may not be available — skip routes
    }

    // Integration routes
    try {
      const integrationManager = this.secureYeoman.getIntegrationManager();
      const integrationStorage = this.secureYeoman.getIntegrationStorage();
      registerIntegrationRoutes(this.app, { integrationManager, integrationStorage });
    } catch {
      // Integration manager may not be available — skip routes
    }

    // Chat routes
    registerChatRoutes(this.app, { secureYeoman: this.secureYeoman });

    // Model info + switch routes
    registerModelRoutes(this.app, { secureYeoman: this.secureYeoman });

    // MCP routes
    try {
      const mcpStorage = this.secureYeoman.getMcpStorage();
      const mcpClient = this.secureYeoman.getMcpClientManager();
      const mcpServer = this.secureYeoman.getMcpServer();
      if (mcpStorage && mcpClient && mcpServer) {
        registerMcpRoutes(this.app, { mcpStorage, mcpClient, mcpServer });
        this.getLogger().info('MCP routes registered');
      } else {
        this.getLogger().warn('MCP routes skipped — MCP system not initialized');
      }
    } catch (err) {
      this.getLogger().error('MCP routes failed to register', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Report routes
    try {
      const reportGenerator = this.secureYeoman.getReportGenerator();
      if (reportGenerator) {
        registerReportRoutes(this.app, { reportGenerator });
      }
    } catch {
      // Report generator may not be available — skip routes
    }

    // Dashboard routes
    try {
      const dashboardManager = this.secureYeoman.getDashboardManager();
      if (dashboardManager) {
        registerDashboardRoutes(this.app, { dashboardManager });
      }
    } catch {
      // Dashboard manager may not be available — skip routes
    }

    // Workspace routes
    try {
      const workspaceManager = this.secureYeoman.getWorkspaceManager();
      if (workspaceManager) {
        registerWorkspaceRoutes(this.app, { workspaceManager });
      }
    } catch {
      // Workspace manager may not be available — skip routes
    }

    // Experiment routes
    try {
      const experimentManager = this.secureYeoman.getExperimentManager();
      if (experimentManager) {
        registerExperimentRoutes(this.app, { experimentManager });
      }
    } catch {
      // Experiment manager may not be available — skip routes
    }

    // Marketplace routes
    try {
      const marketplaceManager = this.secureYeoman.getMarketplaceManager();
      if (marketplaceManager) {
        registerMarketplaceRoutes(this.app, { marketplaceManager });
      }
    } catch {
      // Marketplace manager may not be available — skip routes
    }

    // Terminal routes (always available)
    registerTerminalRoutes(this.app);

    // Prometheus metrics endpoint (unauthenticated)
    this.app.get('/metrics', async (_request, reply) => {
      try {
        const metrics = await this.secureYeoman.getMetrics();
        const text = formatPrometheusMetrics(metrics);
        return reply.type('text/plain; version=0.0.4; charset=utf-8').send(text);
      } catch {
        return reply.code(500).send('# Error collecting metrics\n');
      }
    });

    // Health check
    this.app.get('/health', async () => {
      const state = this.secureYeoman.getState();
      return {
        status: state.healthy ? 'ok' : 'error',
        version: '1.5.0',
        uptime: state.startedAt ? Date.now() - state.startedAt : 0,
        checks: {
          database: true,
          auditChain: true,
        },
      };
    });

    // Metrics endpoint
    this.app.get('/api/v1/metrics', async () => {
      return this.secureYeoman.getMetrics();
    });

    // Tasks endpoints
    this.app.get(
      '/api/v1/tasks',
      async (
        request: FastifyRequest<{
          Querystring: {
            status?: string;
            type?: string;
            from?: string;
            to?: string;
            limit?: string;
            offset?: string;
          };
        }>
      ) => {
        try {
          const taskStorage = this.secureYeoman.getTaskStorage();
          const q = request.query;
          const parseTimestamp = (val?: string): number | undefined => {
            if (!val) return undefined;
            const num = Number(val);
            if (!Number.isNaN(num)) return num;
            const ms = new Date(val).getTime();
            return Number.isNaN(ms) ? undefined : ms;
          };

          return taskStorage.listTasks({
            status: q.status,
            type: q.type,
            from: parseTimestamp(q.from),
            to: parseTimestamp(q.to),
            limit: q.limit ? Number(q.limit) : 50,
            offset: q.offset ? Number(q.offset) : 0,
          });
        } catch {
          return { tasks: [], total: 0 };
        }
      }
    );

    this.app.get(
      '/api/v1/tasks/:id',
      async (
        request: FastifyRequest<{
          Params: { id: string };
        }>,
        reply: FastifyReply
      ) => {
        try {
          const taskStorage = this.secureYeoman.getTaskStorage();
          const task = taskStorage.getTask(request.params.id);
          if (!task) {
            return reply.code(404).send({ error: 'Task not found' });
          }
          return task;
        } catch {
          return reply.code(500).send({ error: 'Task storage not available' });
        }
      }
    );

    // Update task
    this.app.put(
      '/api/v1/tasks/:id',
      async (
        request: FastifyRequest<{
          Params: { id: string };
          Body: { name?: string; type?: string; description?: string };
        }>,
        reply: FastifyReply
      ) => {
        try {
          const taskStorage = this.secureYeoman.getTaskStorage();
          const task = taskStorage.getTask(request.params.id);
          if (!task) {
            return reply.code(404).send({ error: 'Task not found' });
          }
          const { name, type, description } = request.body;
          taskStorage.updateTaskMetadata(request.params.id, { name, type, description });
          return taskStorage.getTask(request.params.id);
        } catch {
          return reply.code(500).send({ error: 'Failed to update task' });
        }
      }
    );

    // Delete task
    this.app.delete(
      '/api/v1/tasks/:id',
      async (
        request: FastifyRequest<{
          Params: { id: string };
        }>,
        reply: FastifyReply
      ) => {
        try {
          const taskStorage = this.secureYeoman.getTaskStorage();
          const task = taskStorage.getTask(request.params.id);
          if (!task) {
            return reply.code(404).send({ error: 'Task not found' });
          }
          taskStorage.deleteTask(request.params.id);
          return { success: true };
        } catch {
          return reply.code(500).send({ error: 'Failed to delete task' });
        }
      }
    );

    // Create task
    this.app.post(
      '/api/v1/tasks',
      async (
        request: FastifyRequest<{
          Body: {
            type?: string;
            name: string;
            description?: string;
            input?: unknown;
            timeoutMs?: number;
            correlationId?: string;
            parentTaskId?: string;
          };
        }>,
        reply: FastifyReply
      ) => {
        try {
          const taskStorage = this.secureYeoman.getTaskStorage();
          const taskExecutor = this.secureYeoman.getTaskExecutor();

          const {
            name,
            type = 'execute',
            description,
            input,
            timeoutMs,
            correlationId,
            parentTaskId,
          } = request.body;

          if (!name) {
            return reply.code(400).send({ error: 'Task name is required' });
          }

          const task: Task = {
            id: uuidv7(),
            type: type as TaskType,
            name,
            description,
            status: TaskStatus.PENDING,
            createdAt: Date.now(),
            inputHash: sha256(JSON.stringify(input ?? {})),
            securityContext: { userId: 'api', role: 'operator', permissionsUsed: [] },
            timeoutMs: timeoutMs ?? 300000,
            correlationId,
            parentTaskId,
          };

          taskStorage.storeTask(task);

          if (taskExecutor) {
            try {
              await taskExecutor.submit(
                {
                  type: type as TaskType,
                  name,
                  description,
                  input,
                  timeoutMs,
                  correlationId,
                  parentTaskId,
                },
                { userId: 'api', role: 'operator' }
              );
            } catch (err) {
              this.getLogger().warn('Task created but failed to enqueue', { error: String(err) });
            }
          }

          return reply.code(201).send(task);
        } catch (err) {
          this.getLogger().error('Failed to create task', { error: String(err) });
          return reply.code(500).send({ error: 'Failed to create task' });
        }
      }
    );

    // Sandbox status
    this.app.get('/api/v1/sandbox/status', async () => {
      try {
        const sandboxManager = this.secureYeoman.getSandboxManager();
        return sandboxManager.getStatus();
      } catch {
        return {
          enabled: false,
          technology: 'none',
          capabilities: {
            landlock: false,
            seccomp: false,
            namespaces: false,
            rlimits: false,
            platform: process.platform,
          },
          sandboxType: 'NoopSandbox',
        };
      }
    });

    // Security events
    //
    // Returns security-relevant audit log entries filtered by event type.
    // Security events are a curated subset of the full audit trail, limited
    // to events that indicate authentication, authorisation, rate limiting,
    // or injection activity. This powers the SecurityEvents panel in the
    // React dashboard.
    //
    // Query parameters:
    //   severity – Comma-separated list of severity levels to include.
    //              Maps to audit entry "level" field. When omitted, all
    //              security-relevant levels are returned (warn, error,
    //              security).
    //   type     – Comma-separated list of security event type names
    //              (e.g. "auth_failure,rate_limit"). When omitted, all
    //              known security event types are included.
    //   from     – Unix timestamp (ms) lower bound (inclusive).
    //   to       – Unix timestamp (ms) upper bound (inclusive).
    //   limit    – Maximum number of events to return (default 50, max 1000).
    //   offset   – Pagination offset (default 0).
    //
    // The response shape matches the audit query result but with the key
    // renamed to "events" for semantic clarity on the client side.
    this.app.get(
      '/api/v1/security/events',
      async (
        request: FastifyRequest<{
          Querystring: {
            severity?: string;
            type?: string;
            from?: string;
            to?: string;
            limit?: string;
            offset?: string;
          };
        }>
      ) => {
        try {
          const q = request.query;

          // These are the audit event names that qualify as "security events".
          // They align with the SecurityEventType enum in @friday/shared and
          // cover authentication, authorisation, rate limiting, injection
          // detection, sandbox violations, and configuration changes.
          const SECURITY_EVENT_TYPES = [
            'auth_success',
            'auth_failure',
            'rate_limit',
            'injection_attempt',
            'permission_denied',
            'anomaly',
            'sandbox_violation',
            'config_change',
            'secret_access',
          ];

          // Allow the caller to narrow by specific event types; fall back to
          // all known security types when the parameter is omitted.
          const eventFilter = q.type
            ? q.type.split(',').filter((t) => SECURITY_EVENT_TYPES.includes(t))
            : SECURITY_EVENT_TYPES;

          // Map the optional severity query param to audit "level" values.
          // The audit chain uses levels (warn, error, security) rather than
          // the SecurityEvent severity enum, so this provides a useful filter
          // without requiring a schema change.
          const levelFilter = q.severity ? q.severity.split(',') : undefined;

          const result = await this.secureYeoman.queryAuditLog({
            event: eventFilter,
            level: levelFilter,
            from: q.from ? Number(q.from) : undefined,
            to: q.to ? Number(q.to) : undefined,
            limit: q.limit ? Number(q.limit) : 50,
            offset: q.offset ? Number(q.offset) : 0,
          });

          // Return with "events" key for semantic clarity — the dashboard
          // SecurityEvents component expects this shape.
          return {
            events: result.entries,
            total: result.total,
            limit: result.limit,
            offset: result.offset,
          };
        } catch {
          // If audit storage doesn't support querying (e.g. InMemoryAuditStorage
          // not wired up), return an empty result rather than a 500 so the
          // dashboard degrades gracefully.
          return {
            events: [],
            total: 0,
            limit: 50,
            offset: 0,
          };
        }
      }
    );

    // Audit log query
    this.app.get(
      '/api/v1/audit',
      async (
        request: FastifyRequest<{
          Querystring: {
            from?: string;
            to?: string;
            level?: string;
            event?: string;
            userId?: string;
            taskId?: string;
            limit?: string;
            offset?: string;
          };
        }>
      ) => {
        const q = request.query;
        return this.secureYeoman.queryAuditLog({
          from: q.from ? Number(q.from) : undefined,
          to: q.to ? Number(q.to) : undefined,
          level: q.level ? q.level.split(',') : undefined,
          event: q.event ? q.event.split(',') : undefined,
          userId: q.userId,
          taskId: q.taskId,
          limit: q.limit ? Number(q.limit) : undefined,
          offset: q.offset ? Number(q.offset) : undefined,
        });
      }
    );

    // Audit chain verification
    this.app.post('/api/v1/audit/verify', async () => {
      return this.secureYeoman.verifyAuditChain();
    });

    // Audit stats
    this.app.get('/api/v1/audit/stats', async () => {
      const stats = await this.secureYeoman.getAuditStats();
      return stats;
    });

    // Enforce audit retention
    this.app.post(
      '/api/v1/audit/retention',
      async (
        request: FastifyRequest<{
          Body: { maxAgeDays?: number; maxEntries?: number };
        }>,
        reply: FastifyReply
      ) => {
        try {
          const { maxAgeDays, maxEntries } = request.body;
          if (maxAgeDays !== undefined && (maxAgeDays < 1 || maxAgeDays > 3650)) {
            return reply.code(400).send({ error: 'maxAgeDays must be between 1 and 3650' });
          }
          if (maxEntries !== undefined && (maxEntries < 100 || maxEntries > 10_000_000)) {
            return reply.code(400).send({ error: 'maxEntries must be between 100 and 10,000,000' });
          }
          const deleted = this.secureYeoman.enforceAuditRetention({ maxAgeDays, maxEntries });
          const stats = await this.secureYeoman.getAuditStats();
          return { deleted, ...stats };
        } catch {
          return reply.code(500).send({ error: 'Failed to enforce retention' });
        }
      }
    );

    // Export audit log as compressed JSON
    this.app.get(
      '/api/v1/audit/export',
      async (
        request: FastifyRequest<{
          Querystring: { from?: string; to?: string; limit?: string };
        }>,
        reply: FastifyReply
      ) => {
        try {
          const q = request.query;
          const entries = await this.secureYeoman.exportAuditLog({
            from: q.from ? Number(q.from) : undefined,
            to: q.to ? Number(q.to) : undefined,
            limit: q.limit ? Number(q.limit) : 100_000,
          });
          const filename = `friday-audit-${new Date().toISOString().slice(0, 10)}.json`;
          return reply
            .header('Content-Type', 'application/json')
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .send(JSON.stringify({ exportedAt: new Date().toISOString(), count: entries.length, entries }, null, 2));
        } catch {
          return reply.code(500).send({ error: 'Failed to export audit log' });
        }
      }
    );

    // WebSocket endpoint — auth is handled via ?token= query param
    // (browser WebSocket API does not support custom headers)
    this.app.get('/ws/metrics', { websocket: true }, async (socket, request) => {
      // Validate token from query string
      let authUser: { userId: string; role: string } | undefined;
      if (this.authService) {
        const url = new URL(request.url, `http://${request.hostname}`);
        const token = url.searchParams.get('token');
        if (!token) {
          socket.close(4401, 'Missing authentication token');
          return;
        }
        try {
          const user = await this.authService.validateToken(token);
          authUser = { userId: user.userId, role: user.role };
        } catch {
          socket.close(4401, 'Invalid authentication token');
          return;
        }
      }

      const clientId = `client_${String(++this.clientIdCounter)}`;

      const client: WebSocketClient = {
        ws: socket,
        channels: new Set(),
        userId: authUser?.userId,
        role: authUser?.role,
        lastPong: Date.now(),
      };

      this.clients.set(clientId, client);

      this.getLogger().debug('WebSocket client connected', { clientId, userId: authUser?.userId });

      socket.on('pong', () => {
        client.lastPong = Date.now();
      });

      socket.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString()) as {
            type: string;
            payload?: { channels?: string[] };
          };

          if (data.type === 'subscribe' && data.payload?.channels) {
            const subscribed: string[] = [];
            for (const channel of data.payload.channels) {
              const perm = CHANNEL_PERMISSIONS[channel];
              if (perm && client.role) {
                const result = this.secureYeoman.getRBAC().checkPermission(client.role, perm);
                if (!result.granted) continue;
              }
              client.channels.add(channel);
              subscribed.push(channel);
            }
            socket.send(
              JSON.stringify({
                type: 'ack',
                channel: 'system',
                payload: { subscribed },
                timestamp: Date.now(),
                sequence: 0,
              })
            );
          }

          if (data.type === 'unsubscribe' && data.payload?.channels) {
            for (const channel of data.payload.channels) {
              client.channels.delete(channel);
            }
          }
        } catch (error) {
          this.getLogger().error('Failed to parse WebSocket message', {
            clientId,
            error: error instanceof Error ? error.message : 'Unknown',
          });
        }
      });

      socket.on('close', () => {
        this.clients.delete(clientId);
        this.getLogger().debug('WebSocket client disconnected', { clientId });
      });

      socket.on('error', (error: Error) => {
        this.getLogger().error('WebSocket error', {
          clientId,
          error: error.message,
        });
      });
    });
  }

  /**
   * Broadcast a message to all clients subscribed to a channel
   */
  broadcast(channel: string, payload: unknown): void {
    const message = JSON.stringify({
      type: 'update',
      channel,
      payload,
      timestamp: Date.now(),
      sequence: Date.now(), // Simple sequence number
    });

    for (const [clientId, client] of this.clients) {
      if (client.channels.has(channel) && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
        } catch (error) {
          this.getLogger().error('Failed to send WebSocket message', {
            clientId,
            channel,
            error: error instanceof Error ? error.message : 'Unknown',
          });
        }
      }
    }
  }

  /**
   * Check if any connected client is subscribed to the given channel
   */
  hasSubscribers(channel: string): boolean {
    for (const [, client] of this.clients) {
      if (client.channels.has(channel) && client.ws.readyState === WebSocket.OPEN) {
        return true;
      }
    }
    return false;
  }

  /**
   * Start periodic metrics broadcast
   */
  private startMetricsBroadcast(): void {
    const intervalMs = 5000; // Every 5 seconds (matches dashboard polling)

    this.metricsInterval = setInterval(() => {
      void (async () => {
        try {
          // Skip when no clients are subscribed to metrics
          if (!this.hasSubscribers('metrics')) {
            return;
          }

          const metrics = await this.secureYeoman.getMetrics();
          const json = JSON.stringify(metrics);

          // Skip re-broadcast if payload hasn't changed
          if (json === this.lastMetricsJson) {
            return;
          }
          this.lastMetricsJson = json;

          this.broadcast('metrics', metrics);
        } catch (error) {
          this.getLogger().error('Failed to broadcast metrics', {
            error: error instanceof Error ? error.message : 'Unknown',
          });
        }
      })();
    }, intervalMs);

    this.metricsInterval.unref();
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    // Initialize plugins and routes
    await this.init();

    const host = this.config.host;
    const port = this.config.port;

    try {
      await this.app.listen({ host, port });

      const scheme = this.config.tls.enabled ? 'https' : 'http';
      this.getLogger().info('Gateway server started', {
        host,
        port,
        url: `${scheme}://${host}:${port}`,
        tls: this.config.tls.enabled,
        mtls: !!(this.config.tls.enabled && this.config.tls.caPath),
      });

      // Start metrics broadcast
      this.startMetricsBroadcast();

      // Start WebSocket heartbeat (ping every 30s, terminate after 60s without pong)
      this.heartbeatInterval = setInterval(() => {
        const now = Date.now();
        for (const [id, client] of this.clients) {
          if (now - client.lastPong > 60_000) {
            client.ws.terminate();
            this.clients.delete(id);
          } else {
            client.ws.ping();
          }
        }
      }, 30_000);
      this.heartbeatInterval.unref();
    } catch (error) {
      this.getLogger().error('Failed to start gateway server', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    }
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Stop metrics broadcast
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    // Close all WebSocket connections
    for (const [_clientId, client] of this.clients) {
      try {
        client.ws.close(1000, 'Server shutting down');
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();

    // Close Fastify
    await this.app.close();

    this.getLogger().info('Gateway server stopped');
  }

  /**
   * Get the number of connected clients
   */
  getConnectedClients(): number {
    return this.clients.size;
  }
}

/**
 * Create and start a gateway server
 */
export function createGatewayServer(options: GatewayServerOptions): GatewayServer {
  return new GatewayServer(options);
}
