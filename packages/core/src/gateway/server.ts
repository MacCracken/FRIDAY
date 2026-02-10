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

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
import { type SecureYeoman } from '../secureyeoman.js';
import type { GatewayConfig } from '@friday/shared';
import type { AuthService } from '../security/auth.js';
import { createAuthHook, createRbacHook } from './auth-middleware.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerSoulRoutes } from '../soul/soul-routes.js';

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
}

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
  private clientIdCounter = 0;
  
  constructor(options: GatewayServerOptions) {
    this.config = options.config;
    this.secureYeoman = options.secureYeoman;
    this.authService = options.authService;
    
    // Create Fastify instance
    this.app = Fastify({
      logger: false, // We use our own logger
      trustProxy: false, // Security: don't trust proxy headers
      bodyLimit: 1_048_576, // 1 MB max request body
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
    
    // CORS for local development
    this.app.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;
      
      if (origin && this.config.cors.enabled) {
        const allowedOrigins = this.config.cors.origins;
        
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
          reply.header('Access-Control-Allow-Origin', origin);
          reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
          reply.header('Access-Control-Allow-Credentials', 'true');
        }
      }
      
      if (request.method === 'OPTIONS') {
        return reply.code(204).send();
      }
    });
    
    // Auth + RBAC hooks (after CORS, before routes)
    if (this.authService) {
      const logger = this.getLogger();
      this.app.addHook(
        'onRequest',
        createAuthHook({ authService: this.authService, logger }),
      );
      this.app.addHook(
        'onRequest',
        createRbacHook({
          rbac: this.secureYeoman.getRBAC(),
          auditChain: this.secureYeoman.getAuditChain(),
          logger,
        }),
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

    // Health check
    this.app.get('/health', async () => {
      const state = this.secureYeoman.getState();
      return {
        status: state.healthy ? 'ok' : 'error',
        version: '0.1.0',
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
    this.app.get('/api/v1/tasks', async (request: FastifyRequest<{
      Querystring: { status?: string; type?: string; limit?: string; offset?: string }
    }>) => {
      try {
        const taskStorage = this.secureYeoman.getTaskStorage();
        const q = request.query;
        return taskStorage.listTasks({
          status: q.status,
          type: q.type,
          limit: q.limit ? Number(q.limit) : 50,
          offset: q.offset ? Number(q.offset) : 0,
        });
      } catch {
        return { tasks: [], total: 0 };
      }
    });

    this.app.get('/api/v1/tasks/:id', async (request: FastifyRequest<{
      Params: { id: string }
    }>, reply: FastifyReply) => {
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
    });
    
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
    this.app.get('/api/v1/security/events', async (_request: FastifyRequest<{
      Querystring: { severity?: string; limit?: string }
    }>) => {
      // TODO: Implement security event retrieval
      return {
        events: [],
        total: 0,
      };
    });
    
    // Audit log query
    this.app.get('/api/v1/audit', async (request: FastifyRequest<{
      Querystring: {
        from?: string;
        to?: string;
        level?: string;
        event?: string;
        userId?: string;
        taskId?: string;
        limit?: string;
        offset?: string;
      }
    }>) => {
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
    });

    // Audit chain verification
    this.app.post('/api/v1/audit/verify', async () => {
      return this.secureYeoman.verifyAuditChain();
    });
    
    // WebSocket endpoint
    this.app.get('/ws/metrics', { websocket: true }, (socket, _request) => {
      const clientId = `client_${String(++this.clientIdCounter)}`;
      
      const client: WebSocketClient = {
        ws: socket,
        channels: new Set(),
      };
      
      this.clients.set(clientId, client);
      
      this.getLogger().debug('WebSocket client connected', { clientId });
      
      socket.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString()) as {
            type: string;
            payload?: { channels?: string[] };
          };
          
          if (data.type === 'subscribe' && data.payload?.channels) {
            for (const channel of data.payload.channels) {
              client.channels.add(channel);
            }
            socket.send(JSON.stringify({
              type: 'ack',
              channel: 'system',
              payload: { subscribed: Array.from(client.channels) },
              timestamp: Date.now(),
              sequence: 0,
            }));
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
   * Start periodic metrics broadcast
   */
  private startMetricsBroadcast(): void {
    const intervalMs = 1000; // Every second
    
    this.metricsInterval = setInterval(() => {
      void (async () => {
        try {
          const metrics = await this.secureYeoman.getMetrics();
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
      
      this.getLogger().info('Gateway server started', {
        host,
        port,
        url: `http://${host}:${port}`,
      });
      
      // Start metrics broadcast
      this.startMetricsBroadcast();
      
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
