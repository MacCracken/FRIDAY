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

import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';
import { getPool } from '../storage/pg-pool.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyCompress from '@fastify/compress';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { WebSocket } from 'ws';
import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
import { type SecureYeoman } from '../secureyeoman.js';
import type { GatewayConfig } from '@secureyeoman/shared';
import type { AuthService } from '../security/auth.js';
import { ConnectionLimiter } from '../security/connection-limiter.js';
import { IpReputationManager, createIpReputationHook } from '../security/ip-reputation.js';
import { RequestFingerprinter, createFingerprintHook } from '../security/request-fingerprint.js';
import { LowRateDetector, createLowRateDetectorHook } from '../security/low-rate-detector.js';
import { BackpressureManager, createBackpressureHook } from '../security/backpressure.js';
import { createBodyLimitHook } from '../security/body-limit.js';
import { AdaptiveRateLimiter } from '../security/adaptive-rate-limiter.js';
import { isPrivateIp, normalizeIp } from '../utils/ip.js';
import { createAuthHook, createRbacHook } from './auth-middleware.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerOAuthRoutes, OAuthService } from './oauth-routes.js';
import { OAuthTokenStorage } from './oauth-token-storage.js';
import { OAuthTokenService } from './oauth-token-service.js';
import { registerSoulRoutes } from '../soul/soul-routes.js';
import { registerStrategyRoutes } from '../soul/strategy-routes.js';
import { registerBrainRoutes } from '../brain/brain-routes.js';
import { registerAuditRoutes } from '../brain/audit/audit-routes.js';
import { registerDocumentRoutes } from '../brain/document-routes.js';
import { registerSpiritRoutes } from '../spirit/spirit-routes.js';
// registerCommsRoutes — dynamic import (startup optimization)
import { registerIntegrationRoutes } from '../integrations/integration-routes.js';
import { WebhookTransformStorage } from '../integrations/webhook-transform-storage.js';
import { OutboundWebhookStorage } from '../integrations/outbound-webhook-storage.js';
import { OutboundWebhookDispatcher } from '../integrations/outbound-webhook-dispatcher.js';
import { registerChatRoutes } from '../ai/chat-routes.js';
import { registerModelRoutes } from '../ai/model-routes.js';
import { registerInlineCompleteRoutes } from '../ai/inline-complete-routes.js';
import { _clearDynamicCache as clearModelCache } from '../ai/cost-calculator.js';
import { uuidv7, sha256 } from '../utils/crypto.js';
import { runWithCorrelationId } from '../utils/correlation-context.js';
import { Task, TaskType, TaskStatus } from '@secureyeoman/shared';
import { registerMcpRoutes } from '../mcp/mcp-routes.js';
import { McpCredentialManager } from '../mcp/credential-manager.js';
import { requireSecret } from '../config/loader.js';
// registerReportRoutes, registerDashboardRoutes, registerWorkspaceRoutes — dynamic import (startup optimization)
import { registerSsoRoutes } from './sso-routes.js';
// registerExperimentRoutes, registerMarketplaceRoutes — dynamic import (startup optimization)
import { registerTerminalRoutes } from './terminal-routes.js';
import { registerSearchRoutes } from './search-routes.js';
import {
  registerAnnotationRoutes,
  InMemoryAnnotationStorage,
} from '../training/annotation-routes.js';
import { registerWorktreeRoutes } from './worktree-routes.js';
// registerConversationRoutes, registerBranchingRoutes — dynamic import (startup optimization)
// registerAgentRoutes, registerSwarmRoutes, registerProfileSkillsRoutes, registerTeamRoutes, registerCouncilRoutes — dynamic import (startup optimization)
import { registerWorkflowRoutes } from '../workflow/workflow-routes.js';
import { registerExtensionRoutes } from '../extensions/extension-routes.js';
import { registerExecutionRoutes } from '../execution/execution-routes.js';
import { registerA2ARoutes } from '../a2a/a2a-routes.js';
import { registerProactiveRoutes } from '../proactive/proactive-routes.js';
import { registerDiagnosticRoutes } from '../diagnostics/diagnostic-routes.js';
import { registerMultimodalRoutes } from '../multimodal/multimodal-routes.js';
import { registerVoiceStreamRoutes } from '../multimodal/voice/voice-stream-routes.js';
import { registerDesktopRoutes } from '../body/desktop-routes.js';
import { registerVideoStreamRoutes } from '../body/video-stream-routes.js';
import { registerCaptureConsentRoutes } from '../body/capture-consent-routes.js';
import { registerBrowserRoutes } from '../browser/browser-routes.js';
import { registerGroupChatRoutes } from '../integrations/group-chat-routes.js';
import { registerRoutingRulesRoutes } from '../integrations/routing-rules-routes.js';
import { registerIntentRoutes } from '../intent/routes.js';
import { registerAutonomyRoutes } from '../security/autonomy-routes.js';
import { registerNotificationRoutes } from '../notifications/notification-routes.js';
// registerUserNotificationPrefsRoutes — dynamic import (startup optimization)
// registerRiskAssessmentRoutes, registerDepartmentRiskRoutes, registerProviderAccountRoutes — dynamic import (startup optimization)
// registerAthiRoutes, registerSraRoutes, registerConstitutionalRoutes — dynamic import (startup optimization)
import { registerTeeRoutes } from '../security/tee-routes.js';
import { registerDlpRoutes } from '../security/dlp/dlp-routes.js';
import { registerRotationRoutes } from '../security/rotation/rotation-routes.js';
import { TeeAttestationVerifier } from '../security/tee-attestation.js';
import { registerAuditExportRoutes } from '../logging/audit-export-routes.js';
import { SQLiteAuditStorage } from '../logging/sqlite-storage.js';
import { registerBackupRoutes } from '../backup/backup-routes.js';
import { registerTenantRoutes } from '../tenants/tenant-routes.js';
import { registerTrainingRoutes } from '../training/training-routes.js';
import { registerResponsibleAiRoutes } from '../training/responsible-ai-routes.js';
import { registerBatchInferenceRoutes } from '../ai/batch-inference-routes.js';
import { registerContinualLearningRoutes } from '../training/continual-learning-routes.js';
import { registerLicenseRoutes } from '../licensing/license-routes.js';
import { registerFederationRoutes } from '../federation/federation-routes.js';
import { registerGatewayRoutes } from './gateway-routes.js';
import { registerGmailRoutes } from '../integrations/gmail/gmail-routes.js';
import { registerTwitterRoutes } from '../integrations/twitter/twitter-routes.js';
import { registerGithubApiRoutes } from '../integrations/github/github-api-routes.js';
import { registerGoogleCalendarRoutes } from '../integrations/googlecalendar/googlecalendar-routes.js';
import { registerLinearRoutes } from '../integrations/linear/linear-routes.js';
import { registerTodoistRoutes } from '../integrations/todoist/todoist-routes.js';
import { registerJiraRoutes } from '../integrations/jira/jira-routes.js';
import { registerNotionRoutes } from '../integrations/notion/notion-routes.js';
import { registerGoogleWorkspaceRoutes } from '../integrations/google-workspace-routes.js';
import { registerTradingRoutes } from '../integrations/trading/trading-routes.js';
import { registerPhotisnadiRoutes } from '../integrations/photisnadi/photisnadi-routes.js';
import { registerIfranRoutes } from '../integrations/ifran/ifran-routes.js';
import { registerEdgeFleetRoutes } from '../edge/edge-fleet-routes.js';
import { registerEcosystemRoutes } from '../integrations/ecosystem-routes.js';
import { ServiceDiscoveryManager } from '../integrations/service-discovery.js';
import { registerForgeRoutes, registerArtifactRoutes } from '../integrations/forge/index.js';
import { CollabManager } from '../soul/collab.js';
import { SoulStorage } from '../soul/storage.js';
import { formatPrometheusMetrics } from './prometheus.js';
import { sendError, errorToString, toErrorMessage } from '../utils/errors.js';
import { VERSION } from '../version.js';
import { otelFastifyPlugin } from '../telemetry/otel-fastify-plugin.js';
import { registerAlertRoutes } from '../telemetry/alert-routes.js';
import { registerCicdWebhookRoutes } from '../integrations/cicd/cicd-webhook-routes.js';
import { WebhookEventStore } from '../integrations/cicd/webhook-event-store.js';
import { registerWebhookTimelineRoutes } from '../integrations/cicd/webhook-timeline-routes.js';
import { registerArtifactoryRoutes } from '../integrations/forge/artifactory/index.js';
import { registerAdminSettingsRoutes } from './admin-settings-routes.js';
import { registerAnalyticsRoutes } from '../analytics/analytics-routes.js';
import { registerScanningRoutes } from '../sandbox/scanning/scanning-routes.js';
import { parsePagination } from '../utils/pagination.js';

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
  proactive: { resource: 'proactive', action: 'read' },
  workflows: { resource: 'workflows', action: 'read' },
  soul: { resource: 'soul', action: 'read' },
  group_chat: { resource: 'integrations', action: 'read' },
  notifications: { resource: 'notifications', action: 'read' },
  video_stream: { resource: 'capture', action: 'read' },
};

export interface GatewayServerOptions {
  config: GatewayConfig;
  secureYeoman: SecureYeoman;
  authService?: AuthService;
  /** Path to the pre-built dashboard dist directory for SPA serving. */
  dashboardDist?: string;
}

export class GatewayServer {
  private readonly config: GatewayConfig;
  private readonly secureYeoman: SecureYeoman;
  private readonly authService: AuthService | undefined;
  private readonly dashboardDist: string | undefined;
  private readonly app: FastifyInstance;
  private readonly clients = new Map<string, WebSocketClient>();
  private readonly collabManager: CollabManager;
  private readonly connectionLimiter: ConnectionLimiter;
  private readonly ipReputationManager: IpReputationManager | null = null;
  private readonly requestFingerprinter: RequestFingerprinter | null = null;
  private readonly lowRateDetector: LowRateDetector | null = null;
  private readonly backpressureManager: BackpressureManager;
  private adaptiveRateLimiter: AdaptiveRateLimiter | null = null;
  private pressureInterval: NodeJS.Timeout | null = null;
  private logger: SecureLogger | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastMetricsJson: string | null = null;

  /**
   * Register an optional route module. Swallows errors when the manager
   * is unavailable, logging at debug level instead of silently dropping.
   */
  private async tryRegister(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.getLogger().debug(`${name} routes skipped`, {
        reason: errorToString(err),
      });
    }
  }

  constructor(options: GatewayServerOptions) {
    this.config = options.config;
    this.secureYeoman = options.secureYeoman;
    this.authService = options.authService;
    this.dashboardDist = options.dashboardDist;
    this.collabManager = new CollabManager(new SoulStorage());

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
      bodyLimit: this.config.bodyLimits?.uploadBytes ?? 10_485_760, // Global limit = most permissive (upload)
      ...(httpsOpts ? { https: httpsOpts } : {}),
    });

    // Connection-level protection (Slowloris, SYN flood, connection exhaustion)
    this.connectionLimiter = new ConnectionLimiter(
      this.config.connectionLimits ?? {
        maxConnectionsPerIp: 50,
        maxTotalConnections: 1000,
        headersTimeoutMs: 10000,
        requestTimeoutMs: 30000,
        keepAliveTimeoutMs: 60000,
        maxRequestsPerSocket: 1000,
        connectionRatePerIpPerSec: 20,
      }
    );

    // Backpressure / connection-draining
    this.backpressureManager = new BackpressureManager(
      this.config.backpressure ?? { enabled: true, drainPeriodMs: 30000 }
    );

    // IP reputation manager — automated blocklisting based on violation history
    try {
      const secCfg = this.secureYeoman.getConfig?.().security;
      if (secCfg?.ipReputation?.enabled) {
        this.ipReputationManager = new IpReputationManager(secCfg.ipReputation);
      }
    } catch {
      // Config not available yet or security config missing — skip
    }

    // Low-rate distributed attack detection
    try {
      const secCfg = this.secureYeoman.getConfig?.().security;
      if (secCfg?.lowRateDetection?.enabled) {
        this.lowRateDetector = new LowRateDetector(
          secCfg.lowRateDetection,
          this.ipReputationManager ?? undefined
        );
      }
    } catch {
      // Config not available yet or security config missing — skip
    }

    // Request fingerprinting — bot detection via header ordering, behavioral heuristics
    try {
      const secCfg = this.secureYeoman.getConfig?.().security;
      if (secCfg?.requestFingerprinting?.enabled) {
        this.requestFingerprinter = new RequestFingerprinter(
          secCfg.requestFingerprinting,
          this.ipReputationManager ?? undefined
        );
      }
    } catch {
      // Config not available yet or security config missing — skip
    }

    // Middleware and routes are set up in start()
  }

  /**
   * Initialize the server (register plugins, set up middleware)
   */
  private async init(): Promise<void> {
    await this.setupMiddleware();
    await this.setupRoutes();
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
    // Register OpenTelemetry tracing plugin (spans + X-Trace-Id header)
    await this.app.register(otelFastifyPlugin);

    // Normalize IPv6-mapped IPv4 addresses so all downstream hooks see
    // a consistent IP key (e.g. ::ffff:192.168.1.1 → 192.168.1.1).
    this.app.addHook('onRequest', (request, _reply, done) => {
      const raw = request.ip;
      if (raw.startsWith('::ffff:')) {
        Object.defineProperty(request, 'ip', { value: normalizeIp(raw), configurable: true });
      }
      done();
    });

    // Backpressure hook — shed load before any expensive work
    this.app.addHook('onRequest', createBackpressureHook(this.backpressureManager));

    // Request fingerprinting hook — score requests for bot likelihood (before reputation check)
    if (this.requestFingerprinter) {
      this.app.addHook('onRequest', createFingerprintHook(this.requestFingerprinter));
    }

    // IP reputation hook — block IPs with bad reputation scores
    if (this.ipReputationManager) {
      this.app.addHook('onRequest', createIpReputationHook(this.ipReputationManager));
    }

    // Register compression plugin (gzip/brotli for JSON + text responses)
    await this.app.register(fastifyCompress);

    // Register multipart plugin for avatar uploads (max 2 MB per file)
    await this.app.register(fastifyMultipart, {
      limits: { fileSize: 2 * 1024 * 1024 },
    });

    // Register WebSocket plugin
    await this.app.register(fastifyWebsocket, {
      options: {
        maxPayload: 1048576, // 1MB max message size
      },
    });

    // Local network check middleware
    this.app.addHook('onRequest', async (request, reply) => {
      // Skip check entirely when remote access is explicitly allowed (e.g. enterprise TLS deployment)
      if (this.config.allowRemoteAccess) return;

      const ip = request.ip;

      // Allow localhost and private network ranges (RFC 1918 + loopback)
      const isLocalNetwork = isPrivateIp(ip);

      if (!isLocalNetwork) {
        this.getLogger().warn({ ip }, 'Access denied from non-local IP');
        return sendError(reply, 403, 'Dashboard is only accessible from local network');
      }
    });

    // Correlation ID — attach a UUIDv7 to every request and thread it via AsyncLocalStorage
    this.app.decorateRequest('correlationId', '');
    this.app.addHook('onRequest', function (req, reply, done) {
      const id = (req.headers['x-correlation-id'] as string) || uuidv7();
      (req as any).correlationId = id;
      reply.header('X-Correlation-ID', id);
      runWithCorrelationId(id, done);
    });

    // Security headers
    this.app.addHook('onRequest', async (request, reply) => {
      // Generate a unique nonce per request for CSP
      const nonce = randomBytes(16).toString('base64');
      (request as any).cspNonce = nonce;

      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      // X-XSS-Protection: 0 intentionally disables the legacy browser XSS auditor.
      // Modern browsers no longer use it, and enabling it can introduce new vulnerabilities.
      // CSP (below) is the correct defence against XSS.
      reply.header('X-XSS-Protection', '0');
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

      // Content-Security-Policy — defence-in-depth against XSS.
      // Per-request nonce + 'strict-dynamic' replaces 'unsafe-inline' for script-src.
      // 'strict-dynamic' allows dynamically loaded Vite chunks (import()) to execute.
      // style-src retains 'unsafe-inline' — CSS-in-JS and Tailwind inject inline styles.
      // connect-src includes ws:/wss: for WebSocket subscriptions.
      reply.header(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self' ws: wss:",
          "media-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join('; ')
      );

      if (this.config.tls.enabled) {
        // 2-year max-age + preload eligibility
        reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
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

    // ── CSRF guard ────────────────────────────────────────────────────────────
    // This API is stateless and uses HTTP Bearer tokens (Authorization header)
    // and X-API-Key exclusively. No Set-Cookie headers are emitted anywhere in
    // the authentication flow, so CSRF is architecturally not applicable.
    // See ADR 115 for the full analysis.
    //
    // ⚠️  IF YOU ADD COOKIES (e.g. for SSO refresh, remember-me, or session
    //     management), you MUST also add CSRF protection BEFORE shipping:
    //       1. SameSite=Strict (or SameSite=Lax) on every session cookie.
    //       2. @fastify/csrf-protection with a synchronizer token for all
    //          state-changing endpoints (POST, PUT, DELETE, PATCH).
    //     Failure to do so will reintroduce the CSRF attack surface that the
    //     Bearer-token model eliminates.
    // ─────────────────────────────────────────────────────────────────────────

    // Per-route body size enforcement (reject oversized payloads before parsing)
    this.app.addHook(
      'onRequest',
      createBodyLimitHook(
        this.config.bodyLimits ?? {
          defaultBytes: 1_048_576,
          authBytes: 16_384,
          uploadBytes: 10_485_760,
          chatBytes: 524_288,
        }
      )
    );

    // Global rate limiting hook — enforce per-IP limits on all API routes.
    // When adaptive rate limiting is enabled, wrap the inner limiter to
    // dynamically adjust thresholds based on system pressure and feed
    // the composite pressure score into the backpressure manager.
    {
      const rateLimiter = this.secureYeoman.getRateLimiter();
      if (rateLimiter && 'createFastifyHook' in rateLimiter) {
        const securityConfig = this.secureYeoman.getConfig?.()?.security;
        const adaptiveConfig = securityConfig?.rateLimiting?.adaptive;
        if (adaptiveConfig?.enabled) {
          this.adaptiveRateLimiter = new AdaptiveRateLimiter(rateLimiter, adaptiveConfig);
          // Periodically feed pressure into backpressure manager
          this.pressureInterval = setInterval(() => {
            const pressure = this.adaptiveRateLimiter?.getPressure();
            if (pressure) {
              this.backpressureManager.setPressure(pressure.composite);
            }
          }, adaptiveConfig.sampleIntervalMs ?? 5000);
          this.pressureInterval.unref();
        }
        this.app.addHook(
          'onRequest',
          (rateLimiter as import('../security/rate-limiter.js').RateLimiter).createFastifyHook()
        );
      }
    }

    // Auth + RBAC hooks (after CORS, before routes)
    if (this.authService) {
      const logger = this.getLogger();
      this.app.addHook(
        'onRequest',
        createAuthHook({ authService: this.authService, logger, rbac: this.secureYeoman.getRBAC() })
      );
      this.app.addHook(
        'onRequest',
        createRbacHook({
          rbac: this.secureYeoman.getRBAC(),
          auditChain: this.secureYeoman.getAuditChain(),
          logger,
        })
      );
    }

    // IP reputation violation recording — feed rate-limit and auth failure signals
    if (this.ipReputationManager) {
      const reputationMgr = this.ipReputationManager;
      this.app.addHook('onResponse', async (request, reply) => {
        if (reply.statusCode === 429) {
          reputationMgr.recordViolation(request.ip, 10, 'rate_limit');
        } else if (reply.statusCode === 401) {
          reputationMgr.recordViolation(request.ip, 15, 'auth_failure');
        }
      });
    }

    // Request logging
    this.app.addHook('onResponse', async (request, reply) => {
      this.getLogger().debug(
        {
          method: request.method,
          url: request.url,
          statusCode: reply.statusCode,
          responseTime: reply.elapsedTime,
        },
        'Request completed'
      );
    });

    // Low-rate distributed attack detection — non-blocking onResponse hook
    if (this.lowRateDetector) {
      this.app.addHook('onResponse', createLowRateDetectorHook(this.lowRateDetector));
    }
  }

  private async setupRoutes(): Promise<void> {
    // Global error handler — catches body-parse failures, unhandled throws, etc.
    this.app.setErrorHandler((err, _request, reply) => {
      const statusCode = (err as any).statusCode ?? 500;
      const message = statusCode < 500 ? (err as Error).message : 'An unexpected error occurred';
      sendError(reply, statusCode, message);
    });

    // Prevent caching of auth responses (tokens, credentials, session data)
    this.app.addHook('onSend', async (request, reply) => {
      if (request.url.startsWith('/api/v1/auth')) {
        void reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        void reply.header('Pragma', 'no-cache');
      }
    });

    // Auth routes
    if (this.authService) {
      registerAuthRoutes(this.app, {
        authService: this.authService,
        rateLimiter: this.secureYeoman.getRateLimiter(),
        rbac: this.secureYeoman.getRBAC(),
      });
    }

    // SSO routes
    try {
      const ssoManager = this.secureYeoman.getSsoManager();
      const ssoStorage = this.secureYeoman.getSsoStorage();
      if (ssoManager && ssoStorage) {
        const scheme = this.config.tls.enabled ? 'https' : 'http';
        const host = this.config.host === '0.0.0.0' ? 'localhost' : this.config.host;
        const dashboardUrl = `${scheme}://${host}:${this.config.port}`;
        registerSsoRoutes(this.app, {
          ssoManager,
          ssoStorage,
          dashboardUrl,
          secureYeoman: this.secureYeoman,
        });
      }
    } catch {
      // SSO manager may not be available — skip routes
    }

    // OAuth routes
    if (this.authService) {
      const oauthService = new OAuthService();
      const scheme = this.config.tls.enabled ? 'https' : 'http';
      const defaultBaseUrl = `${scheme}://${this.config.host === '0.0.0.0' ? 'localhost' : this.config.host}:${this.config.port}`;

      // Resolve external URL: system preference → env var → computed default
      let baseUrl = this.config.externalUrl || defaultBaseUrl;
      let oauthPublicUrl = this.config.oauthRedirectBaseUrl || undefined;
      try {
        const prefs = this.secureYeoman.getSystemPreferences();
        if (prefs) {
          const storedExternalUrl = await prefs.get('external_url');
          if (storedExternalUrl) baseUrl = storedExternalUrl;
          const storedOauthUrl = await prefs.get('oauth_redirect_base_url');
          if (storedOauthUrl) oauthPublicUrl = storedOauthUrl;
        }
      } catch {
        // System preferences may not be initialized yet — use env/defaults
      }

      // Unified OAuth token service — persists Google tokens across restarts
      const oauthTokenStorage = new OAuthTokenStorage();
      const googleClientId =
        process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GMAIL_OAUTH_CLIENT_ID;
      const googleClientSecret =
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GMAIL_OAUTH_CLIENT_SECRET;
      const githubClientId = process.env.GITHUB_OAUTH_CLIENT_ID;
      const githubClientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
      const oauthTokenService = new OAuthTokenService({
        storage: oauthTokenStorage,
        logger: this.logger ?? createNoopLogger(),
        googleCredentials:
          googleClientId && googleClientSecret
            ? { clientId: googleClientId, clientSecret: googleClientSecret }
            : undefined,
        githubCredentials:
          githubClientId && githubClientSecret
            ? { clientId: githubClientId, clientSecret: githubClientSecret }
            : undefined,
      });

      registerOAuthRoutes(this.app, {
        authService: this.authService,
        oauthService,
        baseUrl,
        publicUrl: oauthPublicUrl,
        oauthTokenService,
      });

      // Wire token service to integration manager so adapters can use it
      try {
        const integrationManager = this.secureYeoman.getIntegrationManager();
        integrationManager.setOAuthTokenService(oauthTokenService);
      } catch {
        // Integration manager may not be available — skip wiring
      }

      // Gmail API proxy routes — uses stored OAuth tokens; respects personality integrationAccess mode
      try {
        let gmailSoulManager;
        try {
          gmailSoulManager = this.secureYeoman.getSoulManager();
        } catch {
          /* optional */
        }
        registerGmailRoutes(this.app, { oauthTokenService, soulManager: gmailSoulManager });
      } catch {
        // Gmail routes are optional — skip on error
      }

      // GitHub API proxy routes — uses stored OAuth tokens; respects personality integrationAccess mode
      try {
        let githubSoulManager;
        try {
          githubSoulManager = this.secureYeoman.getSoulManager();
        } catch {
          /* optional */
        }
        registerGithubApiRoutes(this.app, { oauthTokenService, soulManager: githubSoulManager });
      } catch {
        // GitHub routes are optional — skip on error
      }

      // Google Calendar API proxy routes — uses stored OAuth tokens
      try {
        let gcalSoulManager;
        try {
          gcalSoulManager = this.secureYeoman.getSoulManager();
        } catch {
          /* optional */
        }
        registerGoogleCalendarRoutes(this.app, { oauthTokenService, soulManager: gcalSoulManager });
      } catch {
        // Google Calendar routes are optional — skip on error
      }

      // Google Workspace (Drive, Sheets, Docs) API proxy routes — uses stored OAuth tokens
      try {
        registerGoogleWorkspaceRoutes(this.app, { oauthTokenService });
      } catch {
        // Google Workspace routes are optional — skip on error
      }
    }

    // Soul routes
    try {
      const soulManager = this.secureYeoman.getSoulManager();
      let approvalManager;
      try {
        approvalManager = this.secureYeoman.getApprovalManager();
      } catch {
        /* optional */
      }
      let soulValidator;
      try {
        soulValidator = this.secureYeoman.getValidator();
      } catch {
        /* optional */
      }
      let soulAuditChain;
      try {
        soulAuditChain = this.secureYeoman.getAuditChain();
      } catch {
        /* optional */
      }
      let soulDataDir: string | undefined;
      try {
        soulDataDir = this.secureYeoman.getDataDir();
      } catch {
        /* optional */
      }
      registerSoulRoutes(this.app, {
        soulManager,
        approvalManager,
        broadcast: (payload) => {
          this.broadcast('soul', payload);
        },
        heartbeatManager: this.secureYeoman.getHeartbeatManager(),
        validator: soulValidator,
        auditChain: soulAuditChain,
        dataDir: soulDataDir,
        personalityVersionManager: this.secureYeoman.getPersonalityVersionManager(),
      });
    } catch {
      // Soul manager may not be available — skip routes
    }

    // Strategy routes (Phase 107-A)
    try {
      const strategyStorage = this.secureYeoman.getStrategyStorage();
      let strategyValidator;
      try {
        strategyValidator = this.secureYeoman.getValidator();
      } catch {
        /* optional */
      }
      let strategyAuditChain;
      try {
        strategyAuditChain = this.secureYeoman.getAuditChain();
      } catch {
        /* optional */
      }
      registerStrategyRoutes(this.app, {
        strategyStorage,
        validator: strategyValidator,
        auditChain: strategyAuditChain,
      });
    } catch {
      // Strategy storage may not be available — skip routes
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
      try {
        soulManager = this.secureYeoman.getSoulManager();
      } catch {
        /* may not be available */
      }
      const heartbeatLogStorage = this.secureYeoman.getHeartbeatLogStorage() ?? undefined;
      registerBrainRoutes(this.app, {
        brainManager,
        heartbeatManager,
        heartbeatLogStorage,
        externalSync,
        soulManager,
        cognitiveMemoryManager: this.secureYeoman.getCognitiveMemoryManager() ?? undefined,
        cognitiveStorage: this.secureYeoman.getCognitiveMemoryStorage() ?? undefined,
      });

      try {
        const documentManager = this.secureYeoman.getDocumentManager();
        const brainStorage = this.secureYeoman.getBrainStorage() ?? undefined;
        registerDocumentRoutes(this.app, {
          documentManager,
          brainManager,
          brainStorage,
          broadcast: (channel, payload) => {
            this.broadcast(channel, payload);
          },
          secureYeoman: this.secureYeoman,
        });
      } catch {
        // Document manager may not be available — skip routes
      }

      // Memory Audit routes (Phase 118)
      const auditScheduler = this.secureYeoman.getMemoryAuditScheduler();
      if (auditScheduler) {
        const auditStorage = this.secureYeoman.getMemoryAuditStorage();
        if (auditStorage) {
          registerAuditRoutes(this.app, { auditScheduler, auditStorage });
        }
      }
    } catch {
      // Brain manager may not be available — skip routes
    }

    // Comms routes
    await this.tryRegister('Comms', async () => {
      const agentComms = this.secureYeoman.getAgentComms();
      if (agentComms) {
        const { registerCommsRoutes } = await import('../comms/comms-routes.js');
        registerCommsRoutes(this.app, { agentComms });
      }
    });

    // Integration routes
    try {
      const integrationManager = this.secureYeoman.getIntegrationManager();
      const integrationStorage = this.secureYeoman.getIntegrationStorage();
      const webhookTransformStorage = new WebhookTransformStorage();
      const outboundWebhookStorage = new OutboundWebhookStorage();
      const outboundDispatcher = new OutboundWebhookDispatcher(
        outboundWebhookStorage,
        this.getLogger().child({ component: 'outbound-webhook-dispatcher' })
      );
      integrationManager.setOutboundWebhookDispatcher(outboundDispatcher);
      // Wire dispatcher into message router if it exposes the setter
      const messageRouter = this.secureYeoman.getMessageRouter?.();
      messageRouter?.setOutboundWebhookDispatcher?.(outboundDispatcher);
      registerIntegrationRoutes(this.app, {
        integrationManager,
        integrationStorage,
        webhookTransformStorage,
        outboundWebhookStorage,
        secureYeoman: this.secureYeoman,
      });
    } catch {
      // Integration manager may not be available — skip routes
    }

    // Twitter API proxy routes — uses stored integration credentials; respects personality integrationAccess mode
    try {
      const twitterIntegrationManager = this.secureYeoman.getIntegrationManager();
      let twitterSoulManager;
      try {
        twitterSoulManager = this.secureYeoman.getSoulManager();
      } catch {
        /* optional */
      }
      registerTwitterRoutes(this.app, {
        integrationManager: twitterIntegrationManager,
        soulManager: twitterSoulManager,
      });
    } catch {
      // Twitter routes are optional — skip on error
    }

    // Linear API proxy routes — uses stored integration credentials
    try {
      const linearIm = this.secureYeoman.getIntegrationManager();
      registerLinearRoutes(this.app, { integrationManager: linearIm });
    } catch {
      // Linear routes are optional — skip on error
    }

    // Todoist API proxy routes — uses stored integration credentials
    try {
      const todoistIm = this.secureYeoman.getIntegrationManager();
      await registerTodoistRoutes(this.app, { integrationManager: todoistIm });
    } catch {
      // Todoist routes are optional — skip on error
    }

    // Jira API proxy routes — uses stored integration credentials
    try {
      const jiraIm = this.secureYeoman.getIntegrationManager();
      registerJiraRoutes(this.app, { integrationManager: jiraIm });
    } catch {
      // Jira routes are optional — skip on error
    }

    // Notion API proxy routes — uses stored integration credentials
    try {
      const notionIm = this.secureYeoman.getIntegrationManager();
      registerNotionRoutes(this.app, { integrationManager: notionIm });
    } catch {
      // Notion routes are optional — skip on error
    }

    // Photisnadi task/ritual widget proxy routes
    try {
      registerPhotisnadiRoutes(this.app);
    } catch {
      // Photisnadi routes are optional — skip on error
    }

    // Ecosystem service discovery routes (connection-driven enable/disable)
    try {
      const secretsManager = this.secureYeoman.getSecretsManager();
      if (secretsManager) {
        const discoveryManager = new ServiceDiscoveryManager({
          secretsManager,
          logger: this.getLogger().child({ component: 'ServiceDiscovery' }),
        });
        registerEcosystemRoutes(this.app, {
          discoveryManager,
          logger: this.getLogger().child({ component: 'EcosystemRoutes' }),
        });
      }
    } catch {
      // Ecosystem routes are optional — skip on error
    }

    // Code forge routes (repos, PRs, pipelines, releases)
    try {
      const initialForges = [];
      const deltaUrl = process.env.DELTA_URL;
      const deltaToken = process.env.DELTA_API_TOKEN;
      if (deltaUrl) {
        initialForges.push({ provider: 'delta' as const, baseUrl: deltaUrl, token: deltaToken });
      }
      registerForgeRoutes(this.app, { initialForges });
      registerArtifactRoutes(this.app, { initialForges });
      registerArtifactoryRoutes(this.app);
    } catch {
      // Forge routes are optional — skip on error
    }

    // Admin settings routes (system preferences)
    try {
      const systemPreferences = this.secureYeoman.getSystemPreferences();
      if (systemPreferences) {
        registerAdminSettingsRoutes(this.app, { systemPreferences });
      }
    } catch {
      // Admin settings routes are optional — skip if preferences not initialized
    }

    // Trading & market data proxy routes
    try {
      registerTradingRoutes(this.app);
    } catch {
      // Trading routes are optional — skip on error
    }

    // Ifran LLM controller proxy routes
    try {
      registerIfranRoutes(this.app, { secureYeoman: this.secureYeoman });
    } catch {
      // Ifran routes are optional — skip on error
    }

    // Edge fleet management routes (Phase 14C)
    try {
      const edgeStore = this.secureYeoman.getEdgeStore();
      if (edgeStore) {
        registerEdgeFleetRoutes(this.app, { edgeStore, secureYeoman: this.secureYeoman });
      }
    } catch {
      // Edge routes are optional — skip on error
    }

    // Diagnostic routes (Phase 39 — Channel B: sub-agent reporting + integration ping)
    try {
      const soulManager = this.secureYeoman.getSoulManager();
      const integrationManager = this.secureYeoman.getIntegrationManager();
      const mcpClientManager = this.secureYeoman.getMcpClientManager() ?? undefined;
      registerDiagnosticRoutes(this.app, { soulManager, integrationManager, mcpClientManager });
    } catch {
      // Optional — skip if managers unavailable
    }

    // Chat routes
    registerChatRoutes(this.app, { secureYeoman: this.secureYeoman });

    // Model info + switch routes
    registerModelRoutes(this.app, { secureYeoman: this.secureYeoman });

    // Inline AI completion routes
    try {
      const aiClient = this.secureYeoman.getAIClient();
      const soulMgr = this.secureYeoman.getSoulManager();
      registerInlineCompleteRoutes(this.app, {
        aiClient: {
          async complete(prompt, options) {
            const resp = await aiClient.chat({
              messages: [{ role: 'user', content: prompt }],
              temperature: options?.temperature,
              stream: false,
            });
            return resp.content;
          },
        },
        personalityManager: soulMgr
          ? {
              async getById(id: string) {
                return soulMgr.getPersonality(id);
              },
            }
          : undefined,
      });
    } catch {
      // AI client not available — inline completion disabled
    }

    // MCP routes
    try {
      const mcpStorage = this.secureYeoman.getMcpStorage();
      const mcpClient = this.secureYeoman.getMcpClientManager();
      const mcpServer = this.secureYeoman.getMcpServer();
      if (mcpStorage && mcpClient && mcpServer) {
        const tokenSecret = requireSecret(this.config.auth.tokenSecret);
        const credentialManager = new McpCredentialManager(
          mcpStorage,
          this.getLogger(),
          tokenSecret
        );
        registerMcpRoutes(this.app, {
          mcpStorage,
          mcpClient,
          mcpServer,
          credentialManager,
          getNetBoxWriteAllowed: () =>
            this.secureYeoman.getConfig().security.allowNetBoxWrite ?? false,
        });
        // Register credential manager with security module for TOKEN_SECRET rotation re-encryption
        this.secureYeoman.setMcpCredentialManager(credentialManager);
        this.getLogger().info('MCP routes registered');
      } else {
        this.getLogger().warn('MCP routes skipped — MCP system not initialized');
      }
    } catch (err) {
      this.getLogger().error(
        {
          error: errorToString(err),
        },
        'MCP routes failed to register'
      );
    }

    // Report routes
    await this.tryRegister('Report', async () => {
      const reportGenerator = this.secureYeoman.getReportGenerator();
      if (reportGenerator) {
        const complianceReportGenerator =
          this.secureYeoman.getComplianceReportGenerator() ?? undefined;
        const { registerReportRoutes } = await import('../reporting/report-routes.js');
        registerReportRoutes(this.app, { reportGenerator, complianceReportGenerator });
      }
    });

    // Statement of Applicability (SoA) routes
    await this.tryRegister('SoA', async () => {
      const { registerSoaRoutes } = await import('../supply-chain/soa-routes.js');
      registerSoaRoutes(this.app, { secureYeoman: this.secureYeoman });
    });

    // Dashboard routes
    await this.tryRegister('Dashboard', async () => {
      const dashboardManager = this.secureYeoman.getDashboardManager();
      if (dashboardManager) {
        const { registerDashboardRoutes } = await import('../dashboard/dashboard-routes.js');
        registerDashboardRoutes(this.app, { dashboardManager });
      }
    });

    // Workspace routes
    await this.tryRegister('Workspace', async () => {
      const workspaceManager = this.secureYeoman.getWorkspaceManager();
      if (workspaceManager && this.authService) {
        const { registerWorkspaceRoutes } = await import('../workspace/workspace-routes.js');
        registerWorkspaceRoutes(this.app, { workspaceManager, authService: this.authService });
      }
    });

    // Experiment routes
    await this.tryRegister('Experiment', async () => {
      const experimentManager = this.secureYeoman.getExperimentManager();
      if (experimentManager) {
        const { registerExperimentRoutes } = await import('../experiment/experiment-routes.js');
        registerExperimentRoutes(this.app, { experimentManager, secureYeoman: this.secureYeoman });
      }
    });

    // Marketplace routes
    await this.tryRegister('Marketplace', async () => {
      const marketplaceManager = this.secureYeoman.getMarketplaceManager();
      if (marketplaceManager) {
        const { registerMarketplaceRoutes } = await import('../marketplace/marketplace-routes.js');
        registerMarketplaceRoutes(this.app, {
          marketplaceManager,
          getConfig: () => this.secureYeoman.getConfig(),
          ensureDelegationReady: () => this.secureYeoman.ensureDelegationReady(),
          getSoulManager: () => this.secureYeoman.getSoulManager(),
        });
      }
    });

    // Terminal routes (always available)
    registerTerminalRoutes(this.app);
    registerSearchRoutes(this.app);
    registerAnnotationRoutes(this.app, { storage: new InMemoryAnnotationStorage() });
    registerWorktreeRoutes(this.app);

    // Conversation routes
    await this.tryRegister('Conversation', async () => {
      const conversationStorage = this.secureYeoman.getConversationStorage();
      if (conversationStorage) {
        const { registerConversationRoutes } = await import('../chat/conversation-routes.js');
        registerConversationRoutes(this.app, { conversationStorage });
        const { registerConversationExportRoutes } =
          await import('../chat/conversation-export-routes.js');
        registerConversationExportRoutes(this.app, { conversationStorage });
      }
    });

    // Branching & replay routes (Phase 99)
    await this.tryRegister('Branching', async () => {
      const branchingManager = this.secureYeoman.getBranchingManager();
      if (branchingManager) {
        const { registerBranchingRoutes } = await import('../chat/branching-routes.js');
        registerBranchingRoutes(this.app, { branchingManager });
      }
    });

    // Agent delegation routes
    await this.tryRegister('Agent', async () => {
      const subAgentManager = this.secureYeoman.getSubAgentManager();
      if (subAgentManager) {
        const { registerAgentRoutes } = await import('../agents/agent-routes.js');
        registerAgentRoutes(this.app, { subAgentManager });
      }
    });

    // Swarm routes
    await this.tryRegister('Swarm', async () => {
      const swarmManager = this.secureYeoman.getSwarmManager();
      if (swarmManager) {
        const { registerSwarmRoutes } = await import('../agents/swarm-routes.js');
        registerSwarmRoutes(this.app, { swarmManager, secureYeoman: this.secureYeoman });
      }
    });

    // Profile skills routes (Phase 89)
    await this.tryRegister('ProfileSkills', async () => {
      const swarmStorage = this.secureYeoman.getSwarmStorage();
      const subAgentStorage = this.secureYeoman.getSubAgentStorage();
      if (swarmStorage && subAgentStorage) {
        const { registerProfileSkillsRoutes } = await import('../agents/profile-skills-routes.js');
        registerProfileSkillsRoutes(this.app, { swarmStorage, subAgentStorage });
      }
    });

    // Team routes
    await this.tryRegister('Team', async () => {
      const teamManager = this.secureYeoman.getTeamManager();
      if (teamManager) {
        const { registerTeamRoutes } = await import('../agents/team-routes.js');
        registerTeamRoutes(this.app, { teamManager });
      }
    });

    // Council routes
    await this.tryRegister('Council', async () => {
      const councilManager = this.secureYeoman.getCouncilManager();
      if (councilManager) {
        const { registerCouncilRoutes } = await import('../agents/council-routes.js');
        registerCouncilRoutes(this.app, { councilManager, secureYeoman: this.secureYeoman });
      }
    });

    // Workflow routes
    try {
      const workflowManager = this.secureYeoman.getWorkflowManager();
      if (workflowManager) {
        registerWorkflowRoutes(this.app, {
          workflowManager,
          workflowVersionManager: this.secureYeoman.getWorkflowVersionManager(),
        });
        this.getLogger().info('Workflow routes registered');

        // CI/CD inbound webhook normalizer (Phase 90) — public endpoint with HMAC gate
        try {
          const webhookEventStore = new WebhookEventStore();
          registerCicdWebhookRoutes(this.app, {
            workflowManager,
            secureYeoman: this.secureYeoman,
            webhookEventStore,
          });
          registerWebhookTimelineRoutes(this.app, { webhookEventStore });
          this.getLogger().info('CI/CD webhook routes registered');
        } catch (err) {
          this.getLogger().debug(
            {
              reason: errorToString(err),
            },
            'CI/CD webhook routes skipped'
          );
        }
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Workflow routes skipped'
      );
    }

    // Intent routes (org intent documents — Phase 48)
    try {
      const intentManager = this.secureYeoman.getIntentManager();
      if (intentManager) {
        let intentAuditChain;
        try {
          intentAuditChain = this.secureYeoman.getAuditChain();
        } catch {
          /* optional */
        }
        registerIntentRoutes(this.app, { intentManager, auditChain: intentAuditChain });
        this.getLogger().info('Intent routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Intent routes skipped'
      );
    }

    // Autonomy audit routes (Phase 49)
    try {
      const autonomyAuditManager = this.secureYeoman.getAutonomyAuditManager();
      if (autonomyAuditManager) {
        let autonomyAuditChain;
        try {
          autonomyAuditChain = this.secureYeoman.getAuditChain();
        } catch {
          /* optional */
        }
        registerAutonomyRoutes(this.app, {
          autonomyAuditManager,
          auditChain: autonomyAuditChain,
          getAllowWorkflows: () => this.secureYeoman.getConfig().security?.allowWorkflows ?? false,
        });
        this.getLogger().info('Autonomy audit routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Autonomy audit routes skipped'
      );
    }

    // Notification routes (Phase 51 + 55)
    try {
      const notificationManager = this.secureYeoman.getNotificationManager();
      if (notificationManager) {
        // Wire the broadcast callback so server-persisted notifications reach WS clients.
        // This is done here (rather than at init) because broadcast() requires the gateway
        // to be fully constructed.
        notificationManager.setBroadcast((payload: unknown) => {
          this.broadcast('notifications', payload);
        });
        registerNotificationRoutes(this.app, { notificationManager });
        this.getLogger().info('Notification routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Notification routes skipped'
      );
    }

    // User notification prefs routes (Phase 55)
    await this.tryRegister('UserNotificationPrefs', async () => {
      const userNotificationPrefsStorage = this.secureYeoman.getUserNotificationPrefsStorage();
      if (userNotificationPrefsStorage) {
        const { registerUserNotificationPrefsRoutes } =
          await import('../notifications/user-notification-prefs-routes.js');
        registerUserNotificationPrefsRoutes(this.app, { userNotificationPrefsStorage });
      }
    });

    // Risk Assessment routes (Phase 53)
    await this.tryRegister('RiskAssessment', async () => {
      const riskAssessmentManager = this.secureYeoman.getRiskAssessmentManager();
      if (riskAssessmentManager) {
        const { registerRiskAssessmentRoutes } =
          await import('../risk-assessment/risk-assessment-routes.js');
        registerRiskAssessmentRoutes(this.app, {
          riskAssessmentManager,
          secureYeoman: this.secureYeoman,
        });
      }
    });

    // Department Risk Register routes (Phase 111)
    await this.tryRegister('DepartmentRisk', async () => {
      const departmentRiskManager = this.secureYeoman.getDepartmentRiskManager();
      if (departmentRiskManager) {
        const { registerDepartmentRiskRoutes } =
          await import('../risk-assessment/department-risk-routes.js');
        registerDepartmentRiskRoutes(this.app, {
          departmentRiskManager,
          secureYeoman: this.secureYeoman,
        });
      }
    });

    // Provider Account routes (Phase 112)
    await this.tryRegister('ProviderAccount', async () => {
      const providerAccountManager = this.secureYeoman.getProviderAccountManager();
      if (providerAccountManager) {
        const { registerProviderAccountRoutes } = await import('../ai/provider-account-routes.js');
        registerProviderAccountRoutes(this.app, {
          providerAccountManager,
          secureYeoman: this.secureYeoman,
        });
      }
    });

    // ATHI Threat Governance routes (Phase 107-F)
    await this.tryRegister('ATHI', async () => {
      const athiManager = this.secureYeoman.getAthiManager();
      if (athiManager) {
        const { registerAthiRoutes } = await import('../security/athi-routes.js');
        registerAthiRoutes(this.app, { athiManager, secureYeoman: this.secureYeoman });
      }
    });

    // SRA Security Reference Architecture routes (Phase 123)
    await this.tryRegister('SRA', async () => {
      const sraManager = this.secureYeoman.getSraManager();
      if (sraManager) {
        const { registerSraRoutes } = await import('../security/sra-routes.js');
        registerSraRoutes(this.app, { sraManager, secureYeoman: this.secureYeoman });
      }
    });

    // Constitutional AI routes
    await this.tryRegister('Constitutional', async () => {
      const { registerConstitutionalRoutes } = await import('../security/constitutional-routes.js');
      registerConstitutionalRoutes(this.app, this.secureYeoman);
    });

    // TEE / Confidential Computing routes (Phase 129)
    try {
      const teeConfig = this.secureYeoman.getConfig().security?.tee;
      const teeVerifier = new TeeAttestationVerifier(
        {
          enabled: teeConfig?.enabled ?? false,
          providerLevel: teeConfig?.providerLevel ?? 'off',
          attestationStrategy: teeConfig?.attestationStrategy ?? 'none',
          attestationCacheTtlMs: teeConfig?.attestationCacheTtlMs ?? 3_600_000,
          failureAction: teeConfig?.failureAction ?? 'block',
        },
        this.getLogger()
      );
      registerTeeRoutes(this.app, { teeVerifier, secureYeoman: this.secureYeoman });
      this.getLogger().info('TEE confidential computing routes registered');
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'TEE routes skipped'
      );
    }

    // DLP routes (Phase 136)
    try {
      const classificationEngine = this.secureYeoman.getClassificationEngine();
      const classificationStore = this.secureYeoman.getClassificationStore();
      const dlpManager = this.secureYeoman.getDlpManager();
      const dlpPolicyStore = this.secureYeoman.getDlpPolicyStore();
      const watermarkEngine = this.secureYeoman.getWatermarkEngine();
      const watermarkStore = this.secureYeoman.getWatermarkStore();
      const retentionStore = this.secureYeoman.getRetentionStore();
      const retentionManager = this.secureYeoman.getRetentionManager();
      if (classificationEngine && classificationStore) {
        registerDlpRoutes(this.app, {
          classificationEngine,
          classificationStore,
          dlpManager: dlpManager ?? undefined,
          dlpPolicyStore: dlpPolicyStore ?? undefined,
          watermarkEngine: watermarkEngine ?? undefined,
          watermarkStore: watermarkStore ?? undefined,
          retentionStore: retentionStore ?? undefined,
          retentionManager: retentionManager ?? undefined,
          secureYeoman: this.secureYeoman,
        });
        this.getLogger().info('DLP routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'DLP routes skipped'
      );
    }

    // Key rotation admin routes
    registerRotationRoutes(this.app, this.secureYeoman);
    this.getLogger().info('Key rotation routes registered');

    // Access Review & Entitlement Reporting routes (enterprise)
    await this.tryRegister('Access review', async () => {
      const { registerAccessReviewRoutes } =
        await import('../security/access-review/access-review-routes.js');
      const { AccessReviewManager } =
        await import('../security/access-review/access-review-manager.js');
      const rbac = this.secureYeoman.getRBAC();
      const authStorage = this.secureYeoman.getAuthStorage();
      const auditChain = this.secureYeoman.getAuditChain();
      const manager = new AccessReviewManager({ rbac, authStorage, auditChain });
      registerAccessReviewRoutes(this.app, { manager, secureYeoman: this.secureYeoman });
      this.getLogger().info('Access review routes registered');
    });

    // Extension routes
    try {
      const extensionManager = this.secureYeoman.getExtensionManager();
      if (extensionManager) {
        registerExtensionRoutes(this.app, { extensionManager });
        this.getLogger().info('Extension routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Extension routes skipped'
      );
    }

    // Code execution routes
    try {
      const executionManager = this.secureYeoman.getExecutionManager();
      if (executionManager) {
        registerExecutionRoutes(this.app, { executionManager });
        this.getLogger().info('Execution routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Execution routes skipped'
      );
    }

    // A2A protocol routes
    try {
      const a2aManager = this.secureYeoman.getA2AManager();
      if (a2aManager) {
        registerA2ARoutes(this.app, { a2aManager, secureYeoman: this.secureYeoman });
        this.getLogger().info('A2A routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'A2A routes skipped'
      );
    }

    // Proactive assistance routes
    try {
      const proactiveManager = this.secureYeoman.getProactiveManager();
      if (proactiveManager) {
        const heartbeatLogStorage = this.secureYeoman.getHeartbeatLogStorage() ?? undefined;
        registerProactiveRoutes(this.app, { proactiveManager, logStorage: heartbeatLogStorage });
        this.getLogger().info('Proactive routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Proactive routes skipped'
      );
    }

    // Multimodal I/O routes
    try {
      const multimodalManager = this.secureYeoman.getMultimodalManager();
      if (multimodalManager) {
        // Security policy gate: block multimodal requests when disabled
        this.app.addHook('onRequest', async (request, reply) => {
          if (request.url.startsWith('/api/v1/multimodal/')) {
            const config = this.secureYeoman.getConfig();
            if (!config.security.allowMultimodal) {
              return sendError(
                reply,
                403,
                'Forbidden: Multimodal I/O is disabled by security policy'
              );
            }
          }
        });
        registerMultimodalRoutes(this.app, { multimodalManager });
        registerVoiceStreamRoutes(this.app, {
          multimodalManager,
          voiceCache: (multimodalManager as any).deps?.voiceCache ?? null,
        });
        this.getLogger().info('Multimodal routes registered (incl. voice streaming)');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Multimodal routes skipped'
      );
    }

    // Desktop Control routes
    try {
      registerDesktopRoutes(this.app, {
        getAllowDesktopControl: () =>
          this.secureYeoman.getConfig().security.allowDesktopControl ?? false,
        getAllowCamera: () => this.secureYeoman.getConfig().security.allowCamera ?? false,
        getAllowMultimodal: () => this.secureYeoman.getConfig().security.allowMultimodal ?? false,
        getCaptureAuditLogger: () => this.secureYeoman.getCaptureAuditLogger(),
        getTrainingBridge: () => this.secureYeoman.getDesktopTrainingBridge(),
      });
      this.getLogger().info('Desktop control routes registered');
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Desktop control routes skipped'
      );
    }

    // Video Streaming routes
    try {
      registerVideoStreamRoutes(this.app, {
        getAllowVideoStreaming: () =>
          this.secureYeoman.getConfig().security.allowVideoStreaming ?? false,
        getAllowDesktopControl: () =>
          this.secureYeoman.getConfig().security.allowDesktopControl ?? false,
        getVideoStreamManager: () => this.secureYeoman.getVideoStreamManager() ?? null,
        isAgnosBridgeAvailable: () => {
          const mgr = this.secureYeoman.getVideoStreamManager();
          // The manager exists only when AGNOS URL was configured at init time
          return !!mgr && !!process.env.AGNOS_RUNTIME_URL;
        },
      });
      this.getLogger().info('Video streaming routes registered');
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Video streaming routes skipped'
      );
    }

    // Capture Consent routes (Phase 108-D)
    try {
      registerCaptureConsentRoutes(this.app, {
        getConsentManager: () => {
          try {
            const { getConsentManager } = require('../body/consent-manager.js');
            return getConsentManager();
          } catch {
            return null;
          }
        },
      });
      this.getLogger().info('Capture consent routes registered');
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Capture consent routes skipped'
      );
    }

    // Browser Automation Session routes
    try {
      const browserSessionStorage = this.secureYeoman.getBrowserSessionStorage();
      if (browserSessionStorage) {
        // Security policy gate: block browser session requests when disabled
        this.app.addHook('onRequest', async (request, reply) => {
          if (request.url.startsWith('/api/v1/browser/')) {
            const currentMcpStorage = this.secureYeoman.getMcpStorage();
            const currentCfg = currentMcpStorage ? await currentMcpStorage.getConfig() : null;
            if (!currentCfg?.exposeBrowser) {
              return sendError(reply, 403, 'Forbidden: Browser automation is disabled');
            }
          }
        });
        // browserConfig is fetched at request time via the /api/v1/browser/config route
        registerBrowserRoutes(this.app, {
          browserSessionStorage,
          browserConfig: { exposeBrowser: true },
          secureYeoman: this.secureYeoman,
        });
        this.getLogger().info('Browser automation routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Browser automation routes skipped'
      );
    }

    // Group Chat View routes
    try {
      const groupChatStorage = this.secureYeoman.getGroupChatStorage();
      const integrationManager = (() => {
        try {
          return this.secureYeoman.getIntegrationManager();
        } catch {
          return null;
        }
      })();
      if (groupChatStorage && integrationManager) {
        registerGroupChatRoutes(this.app, { groupChatStorage, integrationManager });
        this.getLogger().info('Group chat routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Group chat routes skipped'
      );
    }

    // Routing Rules routes
    try {
      const routingRulesStorage = this.secureYeoman.getRoutingRulesStorage();
      const routingRulesManager = this.secureYeoman.getRoutingRulesManager();
      if (routingRulesStorage && routingRulesManager) {
        registerRoutingRulesRoutes(this.app, {
          storage: routingRulesStorage,
          manager: routingRulesManager,
          secureYeoman: this.secureYeoman,
        });
        this.getLogger().info('Routing rules routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Routing rules routes skipped'
      );
    }

    // Audit Log Export routes (Phase 61)
    try {
      const auditStorage = this.secureYeoman.getAuditStorage();
      if (auditStorage instanceof SQLiteAuditStorage) {
        registerAuditExportRoutes(this.app, {
          auditStorage,
          hostname: osHostname(),
          secureYeoman: this.secureYeoman,
        });
        this.getLogger().info('Audit export routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Audit export routes skipped'
      );
    }

    // Backup & DR routes (Phase 61)
    try {
      const backupManager = this.secureYeoman.getBackupManager();
      if (backupManager) {
        registerBackupRoutes(this.app, { backupManager });
        this.getLogger().info('Backup routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Backup routes skipped'
      );
    }

    // Tenant Management routes (Phase 61)
    try {
      const tenantManager = this.secureYeoman.getTenantManager();
      if (tenantManager) {
        registerTenantRoutes(this.app, { tenantManager, secureYeoman: this.secureYeoman });
        this.getLogger().info('Tenant routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Tenant routes skipped'
      );
    }

    // Training dataset export routes
    try {
      registerTrainingRoutes(this.app, { secureYeoman: this.secureYeoman });
      registerResponsibleAiRoutes(this.app, { secureYeoman: this.secureYeoman });
      registerBatchInferenceRoutes(this.app, { secureYeoman: this.secureYeoman });
      registerContinualLearningRoutes(this.app, { secureYeoman: this.secureYeoman });
      registerLicenseRoutes(this.app, { secureYeoman: this.secureYeoman });
      this.getLogger().info('Training routes registered');
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Training routes skipped'
      );
    }

    // Federation routes (Phase 79)
    try {
      const federationManager = this.secureYeoman.getFederationManager();
      if (federationManager) {
        const brainManager = (() => {
          try {
            return this.secureYeoman.getBrainManager();
          } catch {
            return undefined;
          }
        })();
        const marketplaceManager = this.secureYeoman.getMarketplaceManager() ?? undefined;
        const soulManager = (() => {
          try {
            return this.secureYeoman.getSoulManager();
          } catch {
            return undefined;
          }
        })();
        const federationStorage = (federationManager as any)
          .storage as import('../federation/federation-storage.js').FederationStorage;
        registerFederationRoutes(this.app, {
          federationManager,
          federationStorage,
          brainManager,
          marketplaceManager: marketplaceManager as any,
          soulManager: soulManager,
          secureYeoman: this.secureYeoman,
        });
        this.getLogger().info('Federation routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Federation routes skipped'
      );
    }

    // Gateway routes (Phase 80)
    try {
      const authStorage = this.secureYeoman.getAuthStorage();
      registerGatewayRoutes(this.app, {
        secureYeoman: this.secureYeoman,
        authStorage,
      });
      this.getLogger().info('Gateway routes registered');
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Gateway routes skipped'
      );
    }

    // Alert rules routes (Phase 83)
    {
      const alertManager = this.secureYeoman.getAlertManager?.();
      if (alertManager) {
        registerAlertRoutes(this.app, { alertManager, secureYeoman: this.secureYeoman });
        this.getLogger().debug('Alert routes registered');
      }
    }

    // Conversation Analytics routes (Phase 96)
    try {
      registerAnalyticsRoutes(this.app, { secureYeoman: this.secureYeoman });
      this.getLogger().debug('Analytics routes registered');
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Analytics routes skipped'
      );
    }

    // Sandbox Scanning routes (Phase 116)
    try {
      const scanHistoryStore = this.secureYeoman.getScanHistoryStore();
      const quarantineStorage = this.secureYeoman.getQuarantineStorage();
      const externalizationGate = this.secureYeoman.getExternalizationGate();
      const scanningPolicy = this.secureYeoman.getConfig().security?.sandboxArtifactScanning;
      let scanningAuditChain;
      try {
        scanningAuditChain = this.secureYeoman.getAuditChain();
      } catch {
        /* optional */
      }
      registerScanningRoutes(this.app, {
        scanHistoryStore,
        quarantineStorage,
        pipeline: (externalizationGate as any)?.deps?.pipeline ?? null,
        policy: scanningPolicy ?? null,
        auditChain: scanningAuditChain
          ? {
              record: async (
                event: string,
                level: string,
                message: string,
                metadata?: Record<string, unknown>
              ): Promise<void> => {
                await scanningAuditChain.record({
                  event,
                  level: level as 'info' | 'warn' | 'error' | 'security' | 'debug' | 'trace',
                  message,
                  metadata,
                });
              },
            }
          : null,
      });
      this.getLogger().info('Sandbox scanning routes registered');
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Sandbox scanning routes skipped'
      );
    }

    // Event Subscription routes
    try {
      const eventDispatcher = this.secureYeoman.getEventDispatcher();
      const eventSubscriptionStore = this.secureYeoman.getEventSubscriptionStore();
      if (eventDispatcher && eventSubscriptionStore) {
        const { registerEventRoutes } = await import('../events/event-routes.js');
        registerEventRoutes(this.app, {
          dispatcher: eventDispatcher,
          store: eventSubscriptionStore,
        });
        this.getLogger().info('Event subscription routes registered');
      }
    } catch (err) {
      this.getLogger().debug(
        {
          reason: errorToString(err),
        },
        'Event subscription routes skipped'
      );
    }

    // Break-glass emergency access routes — enterprise feature
    await this.tryRegister('BreakGlass', async () => {
      const { registerBreakGlassRoutes } = await import('../security/break-glass-routes.js');
      const { BreakGlassManager } = await import('../security/break-glass.js');
      const { BreakGlassStorage } = await import('../security/break-glass-storage.js');
      const tokenSecret =
        this.secureYeoman.getConfig().gateway?.auth?.tokenSecret ?? 'secureyeoman-default';
      const bgManager = new BreakGlassManager(
        { tokenSecret },
        {
          storage: new BreakGlassStorage(),
          auditChain: this.secureYeoman.getAuditChain(),
          logger: this.getLogger(),
        }
      );
      registerBreakGlassRoutes(this.app, {
        breakGlassManager: bgManager,
        secureYeoman: this.secureYeoman,
      });
    });

    // SCIM 2.0 provisioning routes — enterprise feature
    await this.tryRegister('SCIM', async () => {
      const { registerScimRoutes } = await import('../security/scim-routes.js');
      registerScimRoutes(this.app, { secureYeoman: this.secureYeoman });
    });

    // Per-tenant quota & rate limiting routes — enterprise feature
    await this.tryRegister('Quotas', async () => {
      const { registerQuotaRoutes } = await import('../tenants/quota-routes.js');
      const { TenantQuotaManager } = await import('../tenants/quota-manager.js');
      const { QuotaStorage } = await import('../tenants/quota-storage.js');
      const quotaManager = new TenantQuotaManager(new QuotaStorage());
      registerQuotaRoutes(this.app, { quotaManager, secureYeoman: this.secureYeoman });
    });

    // WebAuthn/FIDO2 authentication routes — community feature (no license gate)
    await this.tryRegister('WebAuthn', async () => {
      const { registerWebAuthnRoutes } = await import('../security/webauthn-routes.js');
      const { WebAuthnManager } = await import('../security/webauthn.js');
      const { WebAuthnStorage } = await import('../security/webauthn-storage.js');
      const hostname = this.config.host ?? 'localhost';
      const port = this.config.port ?? 3000;
      const webAuthnManager = new WebAuthnManager({
        storage: new WebAuthnStorage(),
        rpName: 'SecureYeoman',
        rpId: hostname,
        origin: `http://${hostname}:${port}`,
      });
      registerWebAuthnRoutes(this.app, { webAuthnManager, secureYeoman: this.secureYeoman });
    });

    // Simulation engine routes — enterprise feature
    await this.tryRegister('Simulation', async () => {
      const { registerSimulationRoutes } = await import('../simulation/simulation-routes.js');
      const { SimulationStore } = await import('../simulation/simulation-store.js');
      const { TickDriver } = await import('../simulation/tick-driver.js');
      const { MoodEngine } = await import('../simulation/mood-engine.js');
      const { SpatialEngine } = await import('../simulation/spatial-engine.js');
      const { ExperimentRunner } = await import('../simulation/experiment-runner.js');
      const { InMemoryExperimentStore } = await import('../simulation/experiment-store.js');
      const { TrainingExecutor } = await import('../simulation/training-executor.js');
      const simStore = new SimulationStore();
      const moodEngine = new MoodEngine({ store: simStore, logger: this.getLogger() });

      // Wire mood engine into soul manager for prompt-time mood injection
      try {
        this.secureYeoman.getSoulManager().setMoodEngine(moodEngine);
      } catch {
        // Soul module may not be initialized yet — mood injection will be unavailable
      }

      const spatialEngine = new SpatialEngine({
        store: simStore,
        logger: this.getLogger(),
        moodEngine,
      });
      const { RelationshipGraph } = await import('../simulation/relationship-graph.js');
      const relationshipGraph = new RelationshipGraph({
        store: simStore,
        logger: this.getLogger(),
        moodEngine,
      });

      // Bridge autoresearch experiment runner to real training infrastructure
      const finetuneManager = this.secureYeoman.getFinetuneManager();
      const evalManager = this.secureYeoman.getEvaluationManager();
      const registryManager = this.secureYeoman.getExperimentRegistryManager();

      const trainingExecutor = new TrainingExecutor({
        logger: this.getLogger(),
        jobLauncher: finetuneManager
          ? {
              createJob: (config) => finetuneManager.createJob(config),
              waitForCompletion: async (jobId, timeoutMs) => {
                const deadline = Date.now() + timeoutMs;
                while (Date.now() < deadline) {
                  const job = await finetuneManager.getJob(jobId);
                  if (!job) return { status: 'failed', errorMessage: 'Job not found' };
                  if (job.status === 'complete')
                    return { status: 'complete', adapterPath: job.adapterPath };
                  if (job.status === 'failed')
                    return { status: 'failed', errorMessage: job.errorMessage };
                  if (job.status === 'cancelled')
                    return { status: 'failed', errorMessage: 'Job cancelled' };
                  await new Promise((r) => setTimeout(r, 5000));
                }
                return { status: 'failed', errorMessage: 'Timeout waiting for training job' };
              },
            }
          : undefined,
        evaluator: evalManager
          ? {
              evaluate: async (config) => {
                const result = await evalManager.runEvaluation(config);
                return { metrics: result.metrics as unknown as Record<string, number> };
              },
            }
          : undefined,
        tracker: registryManager
          ? {
              createExperiment: async (data) => {
                const exp = await registryManager.createExperiment({
                  ...data,
                  status:
                    (data.status as 'draft' | 'running' | 'completed' | 'failed' | 'archived') ??
                    'draft',
                });
                return { id: exp.id };
              },
              updateExperiment: (id, updates) =>
                registryManager.updateExperiment(id, {
                  ...updates,
                  status: updates.status as
                    | 'draft'
                    | 'running'
                    | 'completed'
                    | 'failed'
                    | 'archived'
                    | undefined,
                }),
              linkEvalRun: (expId, evalRunId, metrics) =>
                registryManager.linkEvalRun(expId, evalRunId, metrics),
            }
          : undefined,
      });

      const experimentRunner = new ExperimentRunner({
        store: new InMemoryExperimentStore(),
        logger: this.getLogger(),
        executeExperiment: trainingExecutor.createExecutor(),
      });
      const tickDriver = new TickDriver({ store: simStore, logger: this.getLogger(), moodEngine });
      tickDriver.onTick(spatialEngine.createTickHandler());
      tickDriver.onTick(experimentRunner.createTickHandler());
      tickDriver.onTick(relationshipGraph.createTickHandler());
      registerSimulationRoutes(this.app, {
        store: simStore,
        tickDriver,
        moodEngine,
        spatialEngine,
        experimentRunner,
        relationshipGraph,
        secureYeoman: this.secureYeoman,
      });
    });

    // Standard Prometheus scrape endpoint /metrics (unauthenticated, public)
    this.app.get('/metrics', async (_request, reply) => {
      try {
        const metrics = await this.secureYeoman.getMetrics();
        const text = formatPrometheusMetrics(metrics);
        return reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send(text);
      } catch {
        return reply.code(500).send('# Error collecting metrics\n');
      }
    });

    // Prometheus metrics endpoint (legacy path — also unauthenticated)
    this.app.get('/prom/metrics', async (_request, reply) => {
      try {
        const metrics = await this.secureYeoman.getMetrics();
        const text = formatPrometheusMetrics(metrics);
        return reply.type('text/plain; version=0.0.4; charset=utf-8').send(text);
      } catch {
        return reply.code(500).send('# Error collecting metrics\n');
      }
    });

    // ── Health probes ──────────────────────────────────────────────────────────
    // Three levels following Kubernetes probe conventions:
    //   /health/live  — liveness: is the process alive? (fast, no I/O)
    //   /health/ready — readiness: can the process serve traffic? (DB ping)
    //   /health/deep  — diagnostics: full component status (for ops tooling)
    //   /health       — backward-compat alias for /health/ready

    this.app.get('/health/live', async (_request, reply) => {
      reply.code(200);
      return { status: 'ok' };
    });

    this.app.get('/health/ready', async (_request, reply) => {
      const state = this.secureYeoman.getState();
      const checks: Record<string, boolean> = {};

      // Database ping — actual round-trip to verify connectivity
      try {
        const pool = getPool();
        await pool.query('SELECT 1');
        checks.database = true;
      } catch (err) {
        // Skip check when pool is not initialized (e.g. unit tests)
        if (!(err instanceof Error && err.message.includes('not initialized'))) {
          checks.database = false;
        }
      }

      // Application state
      checks.application = state.healthy;

      // Audit chain — non-blocking: just check it's initialized
      try {
        const auditChain = this.secureYeoman.getAuditChain();
        checks.auditChain = !!auditChain;
      } catch {
        checks.auditChain = false;
      }

      const allHealthy = Object.values(checks).every(Boolean);
      reply.code(allHealthy ? 200 : 503);

      return {
        status: allHealthy ? 'ok' : 'degraded',
        version: VERSION,
        uptime: state.startedAt ? Date.now() - state.startedAt : 0,
        checks,
      };
    });

    this.app.get('/health/deep', async (_request, reply) => {
      const state = this.secureYeoman.getState();
      const components: Record<string, { ok: boolean; detail?: string }> = {};

      // Database — full ping with latency measurement
      try {
        const pool = getPool();
        const start = Date.now();
        await pool.query('SELECT 1');
        components.database = { ok: true, detail: `${Date.now() - start}ms` };
      } catch (err) {
        components.database = {
          ok: false,
          detail: toErrorMessage(err),
        };
      }

      // Audit chain count
      try {
        const auditChain = this.secureYeoman.getAuditChain();
        components.auditChain = { ok: true, detail: 'initialized' };
        void auditChain; // satisfy no-unused
      } catch (err) {
        components.auditChain = {
          ok: false,
          detail: err instanceof Error ? err.message : 'Not available',
        };
      }

      // Auth service
      components.auth = {
        ok: !!this.authService,
        detail: this.authService ? 'active' : 'disabled',
      };

      // WebSocket clients
      components.websocket = {
        ok: true,
        detail: `${this.clients.size} client(s) connected`,
      };

      // Intent / governance manager
      try {
        const intentManager = this.secureYeoman.getIntentManager?.();
        components.intent = {
          ok: !!intentManager,
          detail: intentManager ? 'active' : 'not configured',
        };
      } catch {
        components.intent = { ok: false, detail: 'unavailable' };
      }

      // HA health checks (Phase 137)
      try {
        const { runHaHealthChecks } = await import('../ha/ha-health-checks.js');
        const haChecks = await runHaHealthChecks({
          maxReplicationLagMs: 10_000,
          certPath: this.config.tls.certPath ?? undefined,
        });
        for (const [name, check] of Object.entries(haChecks)) {
          components[name] = check;
        }
      } catch {
        // HA checks are optional — skip if module not available
      }

      // Integration adapter status
      try {
        const integrationManager = this.secureYeoman.getIntegrationManager();
        const integrations = await integrationManager.listIntegrations({ enabled: true });
        const activeCount = integrations.length;
        components.integrations = {
          ok: true,
          detail: `${activeCount} active adapter(s)`,
        };
      } catch {
        components.integrations = { ok: true, detail: 'not configured' };
      }

      const allOk = Object.values(components).every((c) => c.ok);
      reply.code(allOk ? 200 : 207); // 207 Multi-Status if partial

      // Memory profiling data
      const mem = process.memoryUsage();

      return {
        status: allOk ? 'ok' : 'partial',
        version: VERSION,
        uptime: state.startedAt ? Date.now() - state.startedAt : 0,
        components,
        memory: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
          arrayBuffers: mem.arrayBuffers,
        },
      };
    });

    // Backward-compatible alias — same semantics as /health/ready
    this.app.get('/health', async (_request, reply) => {
      const state = this.secureYeoman.getState();
      const checks: Record<string, boolean> = {};

      try {
        const pool = getPool();
        await pool.query('SELECT 1');
        checks.database = true;
      } catch (err) {
        // Skip check when pool is not initialized (e.g. unit tests)
        if (!(err instanceof Error && err.message.includes('not initialized'))) {
          checks.database = false;
        }
      }

      checks.application = state.healthy;

      try {
        checks.auditChain = !!this.secureYeoman.getAuditChain();
      } catch {
        checks.auditChain = false;
      }

      const allHealthy = Object.values(checks).every(Boolean);
      reply.code(allHealthy ? 200 : 503);

      const isLoopback = this.config.host === '127.0.0.1' || this.config.host === 'localhost';
      const tlsActive = this.config.tls.enabled || process.env.TLS_TERMINATED_BY_PROXY === 'true';
      const networkMode = isLoopback ? 'local' : tlsActive ? 'public' : 'lan';

      return {
        status: allHealthy ? 'ok' : 'error',
        version: VERSION,
        uptime: state.startedAt ? Date.now() - state.startedAt : 0,
        networkMode,
        checks,
      };
    });

    // Metrics endpoint
    this.app.get('/api/v1/metrics', async () => {
      return this.secureYeoman.getMetrics();
    });

    // Personality activity heatmap — hourly per-personality request counts (Phase 83)
    this.app.get(
      '/api/v1/metrics/personality-activity',
      async (
        request: FastifyRequest<{
          Querystring: { days?: string };
        }>
      ) => {
        const usageStorage = this.secureYeoman.getUsageStorage();
        if (!usageStorage) {
          return { heatmap: [], personalities: [] };
        }

        const days = Math.min(Math.max(Number(request.query.days) || 7, 1), 30);
        const from = Date.now() - days * 86_400_000;

        const records = await usageStorage.queryHistory({
          from,
          groupBy: 'hour',
        });

        // Build heatmap: { hour → { personalityId → requests } }
        const hourMap = new Map<string, Map<string, number>>();
        const personalitySet = new Set<string>();

        for (const r of records) {
          const pid = r.personalityId ?? '_none';
          personalitySet.add(pid);
          let bucket = hourMap.get(r.date);
          if (!bucket) {
            bucket = new Map();
            hourMap.set(r.date, bucket);
          }
          bucket.set(pid, (bucket.get(pid) ?? 0) + r.calls);
        }

        const personalities = [...personalitySet].sort();
        const heatmap = [...hourMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([hour, pMap]) => ({
            hour,
            counts: Object.fromEntries(pMap),
          }));

        return { heatmap, personalities };
      }
    );

    // Cost breakdown endpoint
    this.app.get('/api/v1/costs/breakdown', async () => {
      const aiStats = this.secureYeoman.getAiUsageStats();
      return {
        byProvider: aiStats?.byProvider ?? {},
        recommendations: [],
      };
    });

    // Cost history endpoint
    this.app.get(
      '/api/v1/costs/history',
      async (
        request: FastifyRequest<{
          Querystring: {
            from?: string;
            to?: string;
            provider?: string;
            model?: string;
            personalityId?: string;
            groupBy?: string;
          };
        }>
      ) => {
        const usageStorage = this.secureYeoman.getUsageStorage();
        if (!usageStorage) {
          return {
            records: [],
            totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, calls: 0 },
          };
        }

        const q = request.query;
        const parseNum = (v?: string): number | undefined => {
          if (!v) return undefined;
          const n = Number(v);
          return Number.isNaN(n) ? undefined : n;
        };

        const records = await usageStorage.queryHistory({
          from: parseNum(q.from),
          to: parseNum(q.to),
          provider: q.provider || undefined,
          model: q.model || undefined,
          personalityId: q.personalityId || undefined,
          groupBy: q.groupBy === 'hour' ? 'hour' : 'day',
        });

        const totals = records.reduce(
          (acc, r) => {
            acc.inputTokens += r.inputTokens;
            acc.outputTokens += r.outputTokens;
            acc.totalTokens += r.totalTokens;
            acc.costUsd += r.costUsd;
            acc.calls += r.calls;
            return acc;
          },
          { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, calls: 0 }
        );

        return { records, totals };
      }
    );

    // Reset a usage stat counter (errors or latency) to zero
    this.app.post(
      '/api/v1/costs/reset',
      async (request: FastifyRequest<{ Body: { stat: string } }>, reply: FastifyReply) => {
        const { stat } = request.body ?? {};
        if (stat !== 'errors' && stat !== 'latency') {
          return sendError(reply, 400, 'stat must be "errors" or "latency"');
        }
        try {
          await this.secureYeoman.resetUsageStat(stat);
          return { success: true, stat };
        } catch (err) {
          const message = toErrorMessage(err);
          return sendError(reply, 500, message);
        }
      }
    );

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
            ...parsePagination(q, { defaultLimit: 50 }),
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
          const task = await taskStorage.getTask(request.params.id);
          if (!task) {
            return sendError(reply, 404, 'Task not found');
          }
          return task;
        } catch {
          return sendError(reply, 500, 'Task storage not available');
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
          const task = await taskStorage.getTask(request.params.id);
          if (!task) {
            return sendError(reply, 404, 'Task not found');
          }
          const { name, type, description } = request.body;
          await taskStorage.updateTaskMetadata(request.params.id, { name, type, description });
          return taskStorage.getTask(request.params.id);
        } catch {
          return sendError(reply, 500, 'Failed to update task');
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
          const task = await taskStorage.getTask(request.params.id);
          if (!task) {
            return sendError(reply, 404, 'Task not found');
          }
          await taskStorage.deleteTask(request.params.id);
          return { success: true };
        } catch {
          return sendError(reply, 500, 'Failed to delete task');
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
            return sendError(reply, 400, 'Task name is required');
          }

          if (taskExecutor) {
            try {
              const executorTask = await taskExecutor.submit(
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
              return reply.code(201).send(executorTask);
            } catch (err) {
              this.getLogger().warn({ error: String(err) }, 'Task execution failed');
              return sendError(reply, 500, 'Task execution failed');
            }
          }

          // No executor available: store as a pending record only
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
          await taskStorage.storeTask(task);
          return reply.code(201).send(task);
        } catch (err) {
          this.getLogger().error({ error: String(err) }, 'Failed to create task');
          return sendError(reply, 500, 'Failed to create task');
        }
      }
    );

    // Sandbox status
    this.app.get('/api/v1/sandbox/status', async () => {
      try {
        const sandboxManager = this.secureYeoman.getSandboxManager();
        return sandboxManager.getStatus();
      } catch (err) {
        this.getLogger().warn({ error: String(err) }, 'Failed to get sandbox status');
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

    // Sandbox config — PATCH to update sandbox settings (supports live switching)
    this.app.patch('/api/v1/sandbox/config', async (request, reply) => {
      try {
        const body = request.body as Record<string, unknown> | null;
        if (!body || typeof body !== 'object') {
          return sendError(reply, 400, 'Request body required');
        }
        const sandboxManager = this.secureYeoman.getSandboxManager();

        // Live technology switching
        if (typeof body.technology === 'string') {
          sandboxManager.switchTechnology(body.technology as any);
          return {
            ok: true,
            message: `Sandbox technology switched to '${body.technology}'. Active immediately.`,
            status: sandboxManager.getStatus(),
          };
        }

        const currentConfig = sandboxManager.getConfig();
        return {
          ok: true,
          message: 'Sandbox configuration updated. Restart required for non-technology changes.',
          current: currentConfig,
          requested: body,
        };
      } catch {
        return sendError(reply, 500, 'Failed to update sandbox config');
      }
    });

    // Sandbox capabilities — detailed availability matrix for all technologies
    this.app.get('/api/v1/sandbox/capabilities', async () => {
      try {
        const sandboxManager = this.secureYeoman.getSandboxManager();
        return {
          technologies: sandboxManager.probeCapabilities(),
          activeTechnology: sandboxManager.getStatus().technology,
          activeStrength: sandboxManager.getStatus().strength,
        };
      } catch {
        return { technologies: [], activeTechnology: 'none', activeStrength: 0 };
      }
    });

    // Sandbox health check — verify the active sandbox is functional
    this.app.get('/api/v1/sandbox/health', async () => {
      try {
        const sandboxManager = this.secureYeoman.getSandboxManager();
        return sandboxManager.healthCheck();
      } catch (err) {
        return {
          healthy: false,
          technology: 'unknown',
          lastChecked: new Date().toISOString(),
          checkDurationMs: 0,
          error: String(err),
        };
      }
    });

    // GPU probe — detect available GPU devices for inference routing
    this.app.get('/api/v1/system/gpu', async (request) => {
      const { probeGpu } = await import('../ai/gpu-probe.js');
      const query = request.query as Record<string, string>;
      const forceRefresh = query.refresh === 'true';
      return probeGpu(forceRefresh);
    });

    // Local models — list locally available models from Ollama/LM Studio/LocalAI
    this.app.get('/api/v1/system/local-models', async (request) => {
      const { refreshLocalModels } = await import('../ai/local-model-registry.js');
      const query = request.query as Record<string, string>;
      const forceRefresh = query.refresh === 'true';
      return refreshLocalModels(forceRefresh);
    });

    // Privacy routing decision — evaluate content for local vs cloud routing
    this.app.post('/api/v1/ai/privacy-route', async (request, reply) => {
      const body = request.body as {
        content?: string;
        capabilities?: string[];
        policy?: string;
      } | null;
      if (!body?.content) {
        return sendError(reply, 400, 'content field required');
      }

      const { probeGpu } = await import('../ai/gpu-probe.js');
      const { refreshLocalModels } = await import('../ai/local-model-registry.js');
      const { routeWithPrivacy } = await import('../ai/privacy-router.js');

      const dlpManager = this.secureYeoman.getDlpManager?.();
      let classificationLevel: 'public' | 'internal' | 'confidential' | 'restricted' = 'public';
      let piiFound: string[] = [];

      if (dlpManager) {
        const classification = dlpManager.getClassificationEngine().classify(body.content);
        classificationLevel = classification.level;
        piiFound = classification.piiFound;
      }

      const [gpu, localModels] = await Promise.all([probeGpu(), refreshLocalModels()]);

      const decision = routeWithPrivacy(
        classificationLevel,
        piiFound,
        gpu,
        localModels,
        body.capabilities ?? [],
        body.policy ? { policy: body.policy as any } : {}
      );

      return decision;
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
          // They align with the SecurityEventType enum in @secureyeoman/shared and
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
            'ai_request',
            'ai_response',
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
            ...parsePagination(q, { defaultLimit: 50 }),
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

    // Security policy — exposes security toggles relevant to the dashboard
    this.app.get('/api/v1/security/policy', async () => {
      const config = this.secureYeoman.getConfig();
      return {
        allowSubAgents: config.security.allowSubAgents,
        allowA2A: config.security.allowA2A,
        allowSwarms: config.security.allowSwarms,
        allowExtensions: config.security.allowExtensions,
        allowExecution: config.security.allowExecution,
        allowProactive: config.security.allowProactive,
        allowWorkflows: config.security.allowWorkflows,
        allowExperiments: config.security.allowExperiments,
        allowStorybook: config.security.allowStorybook,
        allowMultimodal: config.security.allowMultimodal,
        allowDesktopControl: config.security.allowDesktopControl,
        allowCamera: config.security.allowCamera,
        allowDynamicTools: config.security.allowDynamicTools,
        sandboxDynamicTools: config.security.sandboxDynamicTools,
        allowAnomalyDetection: config.security.allowAnomalyDetection,
        sandboxGvisor: config.security.sandboxGvisor,
        sandboxWasm: config.security.sandboxWasm,
        sandboxCredentialProxy: config.security.sandboxCredentialProxy,
        allowCommunityGitFetch: config.security.allowCommunityGitFetch,
        communityGitUrl: config.security.communityGitUrl,
        allowNetworkTools: config.security.allowNetworkTools,
        allowNetBoxWrite: config.security.allowNetBoxWrite,
        allowTwingate: config.security.allowTwingate,
        allowOrgIntent: config.security.allowOrgIntent,
        allowIntent: config.security.allowIntent,
        allowIntentEditor: config.security.allowIntentEditor,
        allowKnowledgeBase: config.security.allowKnowledgeBase,
        allowCodeEditor: config.security.allowCodeEditor,
        allowAdvancedEditor: config.security.allowAdvancedEditor,
        allowTrainingExport: config.security.allowTrainingExport,
        promptGuardMode: config.security.promptGuard.mode,
        responseGuardMode: config.security.responseGuard.mode,
        jailbreakThreshold: config.security.inputValidation?.jailbreakThreshold,
        jailbreakAction: config.security.inputValidation?.jailbreakAction,
        strictSystemPromptConfidentiality: config.security.strictSystemPromptConfidentiality,
        abuseDetectionEnabled: config.security.abuseDetection?.enabled,
        contentGuardrailsEnabled: config.security.contentGuardrails?.enabled ?? false,
        contentGuardrailsPiiMode: config.security.contentGuardrails?.piiMode ?? 'disabled',
        contentGuardrailsToxicityEnabled:
          config.security.contentGuardrails?.toxicityEnabled ?? false,
        contentGuardrailsToxicityMode: config.security.contentGuardrails?.toxicityMode ?? 'warn',
        contentGuardrailsToxicityClassifierUrl:
          config.security.contentGuardrails?.toxicityClassifierUrl,
        contentGuardrailsToxicityThreshold:
          config.security.contentGuardrails?.toxicityThreshold ?? 0.7,
        contentGuardrailsBlockList: config.security.contentGuardrails?.blockList ?? [],
        contentGuardrailsBlockedTopics: config.security.contentGuardrails?.blockedTopics ?? [],
        contentGuardrailsGroundingEnabled:
          config.security.contentGuardrails?.groundingEnabled ?? false,
        contentGuardrailsGroundingMode: config.security.contentGuardrails?.groundingMode ?? 'flag',
      };
    });

    // Security policy — update toggles
    this.app.patch(
      '/api/v1/security/policy',
      async (
        request: FastifyRequest<{
          Body: {
            allowSubAgents?: boolean;
            allowA2A?: boolean;
            allowSwarms?: boolean;
            allowExtensions?: boolean;
            allowExecution?: boolean;
            allowProactive?: boolean;
            allowWorkflows?: boolean;
            allowExperiments?: boolean;
            allowStorybook?: boolean;
            allowMultimodal?: boolean;
            allowDesktopControl?: boolean;
            allowCamera?: boolean;
            allowDynamicTools?: boolean;
            sandboxDynamicTools?: boolean;
            allowAnomalyDetection?: boolean;
            sandboxGvisor?: boolean;
            sandboxWasm?: boolean;
            sandboxCredentialProxy?: boolean;
            allowCommunityGitFetch?: boolean;
            communityGitUrl?: string;
            allowNetworkTools?: boolean;
            allowNetBoxWrite?: boolean;
            allowTwingate?: boolean;
            allowOrgIntent?: boolean;
            allowIntent?: boolean;
            allowIntentEditor?: boolean;
            allowKnowledgeBase?: boolean;
            allowCodeEditor?: boolean;
            allowAdvancedEditor?: boolean;
            allowTrainingExport?: boolean;
            promptGuardMode?: 'block' | 'warn' | 'disabled';
            responseGuardMode?: 'block' | 'warn' | 'disabled';
            jailbreakThreshold?: number;
            jailbreakAction?: 'block' | 'warn' | 'audit_only';
            strictSystemPromptConfidentiality?: boolean;
            abuseDetectionEnabled?: boolean;
            contentGuardrailsEnabled?: boolean;
            contentGuardrailsPiiMode?: 'disabled' | 'detect_only' | 'redact';
            contentGuardrailsToxicityEnabled?: boolean;
            contentGuardrailsToxicityMode?: 'block' | 'warn' | 'audit_only';
            contentGuardrailsToxicityClassifierUrl?: string;
            contentGuardrailsToxicityThreshold?: number;
            contentGuardrailsBlockList?: string[];
            contentGuardrailsBlockedTopics?: string[];
            contentGuardrailsGroundingEnabled?: boolean;
            contentGuardrailsGroundingMode?: 'flag' | 'block';
          };
        }>,
        reply: FastifyReply
      ) => {
        try {
          const {
            allowSubAgents,
            allowA2A,
            allowSwarms,
            allowExtensions,
            allowExecution,
            allowProactive,
            allowWorkflows,
            allowExperiments,
            allowStorybook,
            allowMultimodal,
            allowDesktopControl,
            allowCamera,
            allowDynamicTools,
            sandboxDynamicTools,
            allowAnomalyDetection,
            sandboxGvisor,
            sandboxWasm,
            sandboxCredentialProxy,
            allowCommunityGitFetch,
            communityGitUrl,
            allowNetworkTools,
            allowNetBoxWrite,
            allowTwingate,
            allowOrgIntent,
            allowIntent,
            allowIntentEditor,
            allowKnowledgeBase,
            allowCodeEditor,
            allowAdvancedEditor,
            allowTrainingExport,
            promptGuardMode,
            responseGuardMode,
            jailbreakThreshold,
            jailbreakAction,
            strictSystemPromptConfidentiality,
            abuseDetectionEnabled,
            contentGuardrailsEnabled,
            contentGuardrailsPiiMode,
            contentGuardrailsToxicityEnabled,
            contentGuardrailsToxicityMode,
            contentGuardrailsToxicityClassifierUrl,
            contentGuardrailsToxicityThreshold,
            contentGuardrailsBlockList,
            contentGuardrailsBlockedTopics,
            contentGuardrailsGroundingEnabled,
            contentGuardrailsGroundingMode,
          } = request.body;
          if (
            allowSubAgents === undefined &&
            allowA2A === undefined &&
            allowSwarms === undefined &&
            allowExtensions === undefined &&
            allowExecution === undefined &&
            allowProactive === undefined &&
            allowWorkflows === undefined &&
            allowExperiments === undefined &&
            allowStorybook === undefined &&
            allowMultimodal === undefined &&
            allowDesktopControl === undefined &&
            allowCamera === undefined &&
            allowDynamicTools === undefined &&
            sandboxDynamicTools === undefined &&
            allowAnomalyDetection === undefined &&
            sandboxGvisor === undefined &&
            sandboxWasm === undefined &&
            sandboxCredentialProxy === undefined &&
            allowCommunityGitFetch === undefined &&
            communityGitUrl === undefined &&
            allowNetworkTools === undefined &&
            allowNetBoxWrite === undefined &&
            allowTwingate === undefined &&
            allowOrgIntent === undefined &&
            allowIntent === undefined &&
            allowIntentEditor === undefined &&
            allowKnowledgeBase === undefined &&
            allowCodeEditor === undefined &&
            allowAdvancedEditor === undefined &&
            allowTrainingExport === undefined &&
            promptGuardMode === undefined &&
            responseGuardMode === undefined &&
            jailbreakThreshold === undefined &&
            jailbreakAction === undefined &&
            strictSystemPromptConfidentiality === undefined &&
            abuseDetectionEnabled === undefined &&
            contentGuardrailsEnabled === undefined &&
            contentGuardrailsPiiMode === undefined &&
            contentGuardrailsToxicityEnabled === undefined &&
            contentGuardrailsToxicityMode === undefined &&
            contentGuardrailsToxicityClassifierUrl === undefined &&
            contentGuardrailsToxicityThreshold === undefined &&
            contentGuardrailsBlockList === undefined &&
            contentGuardrailsBlockedTopics === undefined &&
            contentGuardrailsGroundingEnabled === undefined &&
            contentGuardrailsGroundingMode === undefined
          ) {
            return sendError(reply, 400, 'No valid fields provided');
          }
          this.secureYeoman.updateSecurityPolicy({
            allowSubAgents,
            allowA2A,
            allowSwarms,
            allowExtensions,
            allowExecution,
            allowProactive,
            allowWorkflows,
            allowExperiments,
            allowStorybook,
            allowMultimodal,
            allowDesktopControl,
            allowCamera,
            allowDynamicTools,
            sandboxDynamicTools,
            allowAnomalyDetection,
            sandboxGvisor,
            sandboxWasm,
            sandboxCredentialProxy,
            allowCommunityGitFetch,
            communityGitUrl,
            allowNetworkTools,
            allowNetBoxWrite,
            allowTwingate,
            allowOrgIntent,
            allowIntent,
            allowIntentEditor,
            allowKnowledgeBase,
            allowCodeEditor,
            allowAdvancedEditor,
            allowTrainingExport,
            promptGuardMode,
            responseGuardMode,
            jailbreakThreshold,
            jailbreakAction,
            strictSystemPromptConfidentiality,
            abuseDetectionEnabled,
            contentGuardrailsEnabled,
            contentGuardrailsPiiMode,
            contentGuardrailsToxicityEnabled,
            contentGuardrailsToxicityMode,
            contentGuardrailsToxicityClassifierUrl,
            contentGuardrailsToxicityThreshold,
            contentGuardrailsBlockList,
            contentGuardrailsBlockedTopics,
            contentGuardrailsGroundingEnabled,
            contentGuardrailsGroundingMode,
          });

          // Audit the policy change
          try {
            const changedKeys = Object.keys(request.body).filter(
              (k) => (request.body as Record<string, unknown>)[k] !== undefined
            );
            void this.secureYeoman.getAuditChain().record({
              event: 'config_change',
              level: 'info',
              message: 'Security policy updated via dashboard',
              userId: request.authUser?.userId,
              metadata: { changes: changedKeys },
            });
          } catch {
            // Audit is best-effort
          }
          const config = this.secureYeoman.getConfig();
          return {
            allowSubAgents: config.security.allowSubAgents,
            allowA2A: config.security.allowA2A,
            allowSwarms: config.security.allowSwarms,
            allowExtensions: config.security.allowExtensions,
            allowExecution: config.security.allowExecution,
            allowProactive: config.security.allowProactive,
            allowWorkflows: config.security.allowWorkflows,
            allowExperiments: config.security.allowExperiments,
            allowStorybook: config.security.allowStorybook,
            allowMultimodal: config.security.allowMultimodal,
            allowDesktopControl: config.security.allowDesktopControl,
            allowCamera: config.security.allowCamera,
            allowDynamicTools: config.security.allowDynamicTools,
            sandboxDynamicTools: config.security.sandboxDynamicTools,
            allowAnomalyDetection: config.security.allowAnomalyDetection,
            sandboxGvisor: config.security.sandboxGvisor,
            sandboxWasm: config.security.sandboxWasm,
            sandboxCredentialProxy: config.security.sandboxCredentialProxy,
            allowCommunityGitFetch: config.security.allowCommunityGitFetch,
            communityGitUrl: config.security.communityGitUrl,
            allowNetworkTools: config.security.allowNetworkTools,
            allowNetBoxWrite: config.security.allowNetBoxWrite,
            allowTwingate: config.security.allowTwingate,
            allowOrgIntent: config.security.allowOrgIntent,
            allowIntentEditor: config.security.allowIntentEditor,
            allowCodeEditor: config.security.allowCodeEditor,
            allowAdvancedEditor: config.security.allowAdvancedEditor,
            allowTrainingExport: config.security.allowTrainingExport,
            promptGuardMode: config.security.promptGuard.mode,
            responseGuardMode: config.security.responseGuard.mode,
            jailbreakThreshold: config.security.inputValidation?.jailbreakThreshold,
            jailbreakAction: config.security.inputValidation?.jailbreakAction,
            strictSystemPromptConfidentiality: config.security.strictSystemPromptConfidentiality,
            abuseDetectionEnabled: config.security.abuseDetection?.enabled,
            contentGuardrailsEnabled: config.security.contentGuardrails?.enabled ?? false,
            contentGuardrailsPiiMode: config.security.contentGuardrails?.piiMode ?? 'disabled',
            contentGuardrailsToxicityEnabled:
              config.security.contentGuardrails?.toxicityEnabled ?? false,
            contentGuardrailsToxicityMode:
              config.security.contentGuardrails?.toxicityMode ?? 'warn',
            contentGuardrailsToxicityClassifierUrl:
              config.security.contentGuardrails?.toxicityClassifierUrl,
            contentGuardrailsToxicityThreshold:
              config.security.contentGuardrails?.toxicityThreshold ?? 0.7,
            contentGuardrailsBlockList: config.security.contentGuardrails?.blockList ?? [],
            contentGuardrailsBlockedTopics: config.security.contentGuardrails?.blockedTopics ?? [],
            contentGuardrailsGroundingEnabled:
              config.security.contentGuardrails?.groundingEnabled ?? false,
            contentGuardrailsGroundingMode:
              config.security.contentGuardrails?.groundingMode ?? 'flag',
          };
        } catch (err) {
          this.getLogger().error(
            {
              error: errorToString(err),
            },
            'Failed to update security policy'
          );
          return sendError(reply, 500, 'Failed to update security policy');
        }
      }
    );

    // ML Security Summary — aggregates ML-relevant events, computes a risk score,
    // and buckets events into a trend chart.  No ML model is required; the risk
    // score is a deterministic weighted sum based on event counts.
    this.app.get(
      '/api/v1/security/ml/summary',
      async (request: FastifyRequest<{ Querystring: { period?: string } }>) => {
        const ML_EVENT_TYPES = [
          'anomaly',
          'injection_attempt',
          'sandbox_violation',
          'secret_access',
        ] as const;
        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

        const rawPeriod = request.query.period;
        const period: '24h' | '7d' | '30d' =
          rawPeriod === '24h' || rawPeriod === '7d' || rawPeriod === '30d' ? rawPeriod : '7d';

        const now = Date.now();
        const periodMs =
          period === '24h'
            ? 24 * 60 * 60 * 1000
            : period === '7d'
              ? 7 * 24 * 60 * 60 * 1000
              : 30 * 24 * 60 * 60 * 1000;
        const from = now - periodMs;

        const zeroedResponse = (enabled: boolean) => ({
          enabled,
          period,
          riskScore: 0,
          riskLevel: 'low' as const,
          detections: {
            anomaly: 0,
            injectionAttempt: 0,
            sandboxViolation: 0,
            secretAccess: 0,
            total: 0,
          },
          trend: [] as { bucket: string; timestamp: number; count: number }[],
        });

        try {
          const config = this.secureYeoman.getConfig();
          const enabled = config.security.allowAnomalyDetection ?? false;

          const result = await this.secureYeoman.queryAuditLog({
            event: [...ML_EVENT_TYPES],
            from,
            to: now,
            limit: 10000,
            offset: 0,
          });

          const entries = result.entries;

          // Count detections by category
          let anomalyCount = 0;
          let injectionCount = 0;
          let sandboxCount = 0;
          let secretAccessCount = 0;
          for (const e of entries) {
            if (e.event === 'anomaly') anomalyCount++;
            else if (e.event === 'injection_attempt') injectionCount++;
            else if (e.event === 'sandbox_violation') sandboxCount++;
            else if (e.event === 'secret_access') secretAccessCount++;
          }

          // Deterministic risk score (0-100)
          const riskScore = Math.min(
            100,
            clamp(anomalyCount * 10, 0, 30) +
              clamp(injectionCount * 15, 0, 40) +
              clamp(sandboxCount * 20, 0, 30) +
              clamp(secretAccessCount * 5, 0, 20)
          );
          const riskLevel: 'low' | 'medium' | 'high' | 'critical' =
            riskScore < 25
              ? 'low'
              : riskScore < 50
                ? 'medium'
                : riskScore < 75
                  ? 'high'
                  : 'critical';

          // Bucket events by time (hourly for 24h, daily otherwise)
          const bucketMs = period === '24h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
          const bucketCount = period === '24h' ? 24 : period === '7d' ? 7 : 30;
          const buckets = new Map<number, number>();
          for (let i = 0; i < bucketCount; i++) {
            buckets.set(from + i * bucketMs, 0);
          }
          for (const e of entries) {
            const idx = Math.floor((e.timestamp - from) / bucketMs);
            const key = from + idx * bucketMs;
            if (buckets.has(key)) {
              buckets.set(key, (buckets.get(key) ?? 0) + 1);
            }
          }

          const trend = Array.from(buckets.entries())
            .sort(([a], [b]) => a - b)
            .map(([timestamp, count]) => {
              const d = new Date(timestamp);
              const pad = (n: number) => String(n).padStart(2, '0');
              const dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
              const bucket = period === '24h' ? `${dateStr}T${pad(d.getUTCHours())}:00` : dateStr;
              return { bucket, timestamp, count };
            });

          return {
            enabled,
            period,
            riskScore,
            riskLevel,
            detections: {
              anomaly: anomalyCount,
              injectionAttempt: injectionCount,
              sandboxViolation: sandboxCount,
              secretAccess: secretAccessCount,
              total: entries.length,
            },
            trend,
          };
        } catch {
          // Graceful fallback — same pattern as /api/v1/security/events
          try {
            const config = this.secureYeoman.getConfig();
            return zeroedResponse(config.security.allowAnomalyDetection ?? false);
          } catch {
            return zeroedResponse(false);
          }
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
          ...parsePagination(q),
        });
      }
    );

    // Audit chain verification
    this.app.post('/api/v1/audit/verify', async () => {
      return this.secureYeoman.verifyAuditChain();
    });

    // Re-sign chain after a hash-function change (e.g. JSONB metadata key ordering fix)
    this.app.post('/api/v1/audit/repair', async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await this.secureYeoman.repairAuditChain();
        return result;
      } catch {
        return sendError(reply, 500, 'Failed to repair audit chain');
      }
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
            return sendError(reply, 400, 'maxAgeDays must be between 1 and 3650');
          }
          if (maxEntries !== undefined && (maxEntries < 100 || maxEntries > 10_000_000)) {
            return sendError(reply, 400, 'maxEntries must be between 100 and 10,000,000');
          }
          const deleted = this.secureYeoman.enforceAuditRetention({ maxAgeDays, maxEntries });
          const stats = await this.secureYeoman.getAuditStats();
          return { deleted, ...stats };
        } catch {
          return sendError(reply, 500, 'Failed to enforce retention');
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
            limit: parsePagination(q, { defaultLimit: 100_000, maxLimit: 100_000 }).limit,
          });
          const filename = `secureyeoman-audit-${new Date().toISOString().slice(0, 10)}.json`;
          return reply
            .header('Content-Type', 'application/json')
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .send(
              JSON.stringify(
                { exportedAt: new Date().toISOString(), count: entries.length, entries },
                null,
                2
              )
            );
        } catch {
          return sendError(reply, 500, 'Failed to export audit log');
        }
      }
    );

    // ── Phase 41: Secrets Management Routes ─────────────────────────────────

    // GET /api/v1/secrets — list all stored secret names (never values)
    this.app.get('/api/v1/secrets', async (_request, reply) => {
      const sm = this.secureYeoman.getSecretsManager();
      if (!sm) return sendError(reply, 503, 'Secrets manager not available');
      try {
        const keys = await sm.keys();
        return { keys };
      } catch (err) {
        this.getLogger().error(
          {
            error: errorToString(err),
          },
          'Failed to list secrets'
        );
        return sendError(reply, 500, 'Failed to list secrets');
      }
    });

    // GET /api/v1/secrets/:name — check existence only (value is never returned)
    this.app.get(
      '/api/v1/secrets/:name',
      async (request: FastifyRequest<{ Params: { name: string } }>, reply) => {
        const sm = this.secureYeoman.getSecretsManager();
        if (!sm) return sendError(reply, 503, 'Secrets manager not available');
        const { name } = request.params;
        if (!name || !/^[A-Z0-9_]+$/.test(name)) {
          return sendError(reply, 400, 'Secret name must be uppercase alphanumeric/underscore');
        }
        try {
          const exists = await sm.has(name);
          if (!exists) return sendError(reply, 404, 'Secret not found');
          return { name, exists: true };
        } catch (err) {
          this.getLogger().error(
            {
              name,
              error: errorToString(err),
            },
            'Failed to check secret'
          );
          return sendError(reply, 500, 'Failed to check secret');
        }
      }
    );

    // PUT /api/v1/secrets/:name — create or update a secret
    this.app.put(
      '/api/v1/secrets/:name',
      async (
        request: FastifyRequest<{
          Params: { name: string };
          Body: { value: string };
        }>,
        reply
      ) => {
        const sm = this.secureYeoman.getSecretsManager();
        if (!sm) return sendError(reply, 503, 'Secrets manager not available');
        const { name } = request.params;
        if (!name || !/^[A-Z0-9_]+$/.test(name)) {
          return sendError(reply, 400, 'Secret name must be uppercase alphanumeric/underscore');
        }
        const { value } = request.body ?? {};
        if (typeof value !== 'string' || value.length === 0) {
          return sendError(reply, 400, 'Secret value is required');
        }
        try {
          await sm.set(name, value);
          clearModelCache();
          await this.secureYeoman.getAuditChain().record({
            event: 'secret_access',
            level: 'security',
            message: `Secret '${name}' updated`,
            metadata: { operation: 'set', name },
          });
          reply.code(204);
          return;
        } catch (err) {
          this.getLogger().error(
            {
              name,
              error: errorToString(err),
            },
            'Failed to set secret'
          );
          return sendError(reply, 500, 'Failed to set secret');
        }
      }
    );

    // DELETE /api/v1/secrets/:name — remove a secret
    this.app.delete(
      '/api/v1/secrets/:name',
      async (request: FastifyRequest<{ Params: { name: string } }>, reply) => {
        const sm = this.secureYeoman.getSecretsManager();
        if (!sm) return sendError(reply, 503, 'Secrets manager not available');
        const { name } = request.params;
        if (!name || !/^[A-Z0-9_]+$/.test(name)) {
          return sendError(reply, 400, 'Secret name must be uppercase alphanumeric/underscore');
        }
        try {
          const deleted = await sm.delete(name);
          if (!deleted) return sendError(reply, 404, 'Secret not found');
          clearModelCache();
          await this.secureYeoman.getAuditChain().record({
            event: 'secret_access',
            level: 'security',
            message: `Secret '${name}' deleted`,
            metadata: { operation: 'delete', name },
          });
          reply.code(204);
          return;
        } catch (err) {
          this.getLogger().error(
            {
              name,
              error: errorToString(err),
            },
            'Failed to delete secret'
          );
          return sendError(reply, 500, 'Failed to delete secret');
        }
      }
    );

    // ── Internal SSH key store — MCP-only; returns ciphertext for GITHUB_SSH_ secrets ──
    // The MCP service stores AES-256-GCM encrypted SSH private keys under GITHUB_SSH_* names
    // in the SecretsManager.  On container restart, MCP calls this endpoint to retrieve
    // ciphertexts it can decrypt locally (core never sees the plaintext private key material).
    this.app.get('/api/v1/internal/ssh-keys', async (_request, reply) => {
      const sm = this.secureYeoman.getSecretsManager();
      if (!sm) return sendError(reply, 503, 'Secrets manager not available');
      try {
        const allKeys = await sm.keys();
        const sshKeys = allKeys.filter((k) => k.startsWith('GITHUB_SSH_'));
        const entries: { name: string; ciphertext: string }[] = [];
        for (const name of sshKeys) {
          const val = await sm.get(name);
          if (val) entries.push({ name, ciphertext: val });
        }
        return { keys: entries };
      } catch (err) {
        this.getLogger().error(
          {
            error: errorToString(err),
          },
          'Failed to list internal SSH keys'
        );
        return sendError(reply, 500, 'Failed to list SSH keys');
      }
    });

    // ── Internal secrets resolve — MCP service fetches decrypted values at startup ──
    // POST /api/v1/internal/secrets/resolve — resolve a list of secret names to values.
    // Returns only secrets that exist; missing keys are omitted.
    // Service-JWT authenticated (same as /api/v1/internal/ssh-keys).
    this.app.post(
      '/api/v1/internal/secrets/resolve',
      async (request: FastifyRequest<{ Body: { names: string[] } }>, reply) => {
        const sm = this.secureYeoman.getSecretsManager();
        if (!sm) return sendError(reply, 503, 'Secrets manager not available');
        const { names } = request.body ?? {};
        if (!Array.isArray(names) || names.length === 0) {
          return sendError(reply, 400, 'names array is required');
        }
        // Cap at 100 to prevent abuse
        if (names.length > 100) {
          return sendError(reply, 400, 'Too many names (max 100)');
        }
        try {
          const resolved: Record<string, string> = {};
          for (const name of names) {
            if (typeof name !== 'string' || !/^[A-Z0-9_]+$/.test(name)) continue;
            const val = await sm.get(name);
            if (val) resolved[name] = val;
          }
          return { secrets: resolved };
        } catch (err) {
          this.getLogger().error(
            {
              error: errorToString(err),
            },
            'Failed to resolve secrets'
          );
          return sendError(reply, 500, 'Failed to resolve secrets');
        }
      }
    );

    // ── MCP bootstrap — unauthenticated, internal-network-only ─────────────
    // MCP service polls this on startup to retrieve its auto-provisioned API key.
    // The endpoint is in PUBLIC_ROUTES (no auth) but restricted to loopback
    // and RFC-1918 private networks (Docker bridge / overlay).
    this.app.get('/api/v1/internal/mcp-bootstrap', async (request, reply) => {
      const ip = request.ip;
      if (!isPrivateIp(ip)) {
        return sendError(reply, 403, 'Bootstrap endpoint is internal-network-only');
      }
      try {
        const { loadAutoSecret } = await import('../security/auto-secret-store.js');
        const { MCP_SERVICE_API_KEY_SECRET } = await import('../modules/security-module.js');
        const apiKey = await loadAutoSecret(MCP_SERVICE_API_KEY_SECRET);
        if (!apiKey) {
          return sendError(reply, 503, 'MCP service API key not yet provisioned');
        }
        return { apiKey };
      } catch (err) {
        this.getLogger().error({ error: errorToString(err) }, 'Failed to serve MCP bootstrap key');
        return sendError(reply, 500, 'Failed to retrieve bootstrap key');
      }
    });

    // ── Phase 42: TLS Certificate Routes ────────────────────────────────────

    // GET /api/v1/security/tls — TLS cert status for dashboard display
    this.app.get('/api/v1/security/tls', async (_request, reply) => {
      const tlsMgr = this.secureYeoman.getTlsManager();
      if (!tlsMgr) return sendError(reply, 503, 'TLS manager not available');
      try {
        const status = await tlsMgr.getCertStatus();
        return status;
      } catch (err) {
        this.getLogger().error(
          {
            error: errorToString(err),
          },
          'Failed to get TLS status'
        );
        return sendError(reply, 500, 'Failed to get TLS status');
      }
    });

    // POST /api/v1/security/tls/generate — trigger cert regeneration (dev only)
    this.app.post('/api/v1/security/tls/generate', async (_request, reply) => {
      const config = this.secureYeoman.getConfig();
      if (config.core.environment === 'production') {
        return sendError(reply, 403, 'Cert auto-generation is not allowed in production');
      }
      const tlsMgr = this.secureYeoman.getTlsManager();
      if (!tlsMgr) return sendError(reply, 503, 'TLS manager not available');
      try {
        const paths = await tlsMgr.ensureCerts();
        return { generated: true, paths };
      } catch (err) {
        this.getLogger().error(
          {
            error: errorToString(err),
          },
          'Failed to generate TLS cert'
        );
        return sendError(reply, 500, 'Failed to generate TLS certificate');
      }
    });

    // SPA static serving (must be last — any non-API route falls through to index.html)
    const distPath = this.resolveDashboardDist();
    if (distPath) {
      // Pre-read the SPA shell as a template so we can inject per-request CSP nonces
      // into script tags before serving.
      const indexHtmlTemplate = readFileSync(join(distPath, 'index.html'), 'utf-8');

      // Intercept root path to inject nonce into index.html (before @fastify/static)
      this.app.get('/', async (request, reply) => {
        const nonce = (request as any).cspNonce ?? '';
        const html = indexHtmlTemplate.replace(/<script/g, `<script nonce="${nonce}"`);
        return reply.type('text/html').send(html);
      });

      // decorateReply must remain true (the default) so reply.sendFile() is available
      // inside the setNotFoundHandler below.
      void this.app.register(fastifyStatic, {
        root: distPath,
        prefix: '/',
      });

      // SPA fallback: serve index.html for SPA routes; JSON 404 for everything else.
      this.app.setNotFoundHandler((_request, reply) => {
        // Strip query string before all prefix/extension checks
        const pathname = _request.url.split('?')[0] ?? _request.url;
        // API and WebSocket routes always return JSON 404
        if (pathname.startsWith('/api/') || pathname.startsWith('/ws/')) {
          return sendError(reply, 404, 'Not found');
        }
        // Static asset requests (URL contains a file extension in the last segment)
        // return JSON 404 rather than the SPA shell — serving index.html as a .js
        // or .css file causes parse errors in the browser.
        if (/\.[^/]+$/.test(pathname)) {
          return sendError(reply, 404, 'Not found');
        }
        // Inject CSP nonce into script tags
        const nonce = (_request as any).cspNonce ?? '';
        const html = indexHtmlTemplate.replace(/<script/g, `<script nonce="${nonce}"`);
        return reply.type('text/html').send(html);
      });
      this.getLogger().info({ distPath }, 'Dashboard SPA serving enabled');
    }

    // WebSocket endpoint — auth via Sec-WebSocket-Protocol header (token.* subprotocol)
    this.app.get('/ws/metrics', { websocket: true }, async (socket, request) => {
      // Extract token from Sec-WebSocket-Protocol subprotocol (e.g. "token.<jwt>")
      // Note: ?token= query param auth was removed — it leaks tokens in logs/history/referrers
      let authUser: { userId: string; role: string } | undefined;
      if (this.authService) {
        const protocols = request.headers['sec-websocket-protocol'];
        const token =
          typeof protocols === 'string'
            ? protocols
                .split(',')
                .map((p) => p.trim())
                .find((p) => p.startsWith('token.'))
                ?.slice(6)
            : undefined;

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

      // Evict the oldest idle client when the cap is reached
      if (this.clients.size >= this.config.maxWsClients) {
        let oldestId: string | null = null;
        let oldestPong = Infinity;
        for (const [id, c] of this.clients) {
          if (c.lastPong < oldestPong) {
            oldestPong = c.lastPong;
            oldestId = id;
          }
        }
        if (oldestId) {
          const evicted = this.clients.get(oldestId);
          evicted?.ws.close(1008, 'Connection limit reached');
          this.clients.delete(oldestId);
          this.getLogger().warn(
            {
              evictedId: oldestId,
              cap: this.config.maxWsClients,
            },
            'WebSocket client evicted (cap reached)'
          );
        }
      }

      const clientId = `client_${uuidv7()}`;

      const client: WebSocketClient = {
        ws: socket,
        channels: new Set(),
        userId: authUser?.userId,
        role: authUser?.role,
        lastPong: Date.now(),
      };

      this.clients.set(clientId, client);

      this.getLogger().debug({ clientId, userId: authUser?.userId }, 'WebSocket client connected');

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
            // Cap channel subscriptions to prevent memory exhaustion
            const maxChannels = 50;
            const channelsToProcess = data.payload.channels.slice(0, maxChannels);
            const subscribed: string[] = [];
            for (const channel of channelsToProcess) {
              const perm = CHANNEL_PERMISSIONS[channel];
              if (perm) {
                // Fail-secure: if channel requires a permission and client has no role, deny
                if (!client.role) continue;
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
            const unsubscribed: string[] = [];
            for (const channel of data.payload.channels) {
              // Only unsubscribe from channels the client is actually subscribed to
              if (client.channels.has(channel)) {
                const perm = CHANNEL_PERMISSIONS[channel];
                if (perm && client.role) {
                  const result = this.secureYeoman.getRBAC().checkPermission(client.role, perm);
                  if (!result.granted) continue;
                }
                client.channels.delete(channel);
                unsubscribed.push(channel);
              }
            }
            socket.send(
              JSON.stringify({
                type: 'ack',
                channel: 'system',
                payload: { unsubscribed },
                timestamp: Date.now(),
                sequence: 0,
              })
            );
          }
        } catch (error) {
          this.getLogger().error(
            {
              clientId,
              error: error instanceof Error ? error.message : 'Unknown',
            },
            'Failed to parse WebSocket message'
          );
        }
      });

      socket.on('close', () => {
        this.clients.delete(clientId);
        this.getLogger().debug({ clientId }, 'WebSocket client disconnected');
      });

      socket.on('error', (error: Error) => {
        this.getLogger().error(
          {
            clientId,
            error: error.message,
          },
          'WebSocket error'
        );
      });
    });

    // ── Collaborative editing endpoint (Yjs binary protocol) ────────────
    // Path: /ws/collab/:docId — auth via Sec-WebSocket-Protocol (token.* subprotocol)
    // docId format: "personality:<uuid>" | "skill:<uuid>"
    this.app.get(
      '/ws/collab/:docId',
      { websocket: true },
      async (socket, request: FastifyRequest<{ Params: { docId: string } }>) => {
        const { docId } = request.params;

        // Auth via Sec-WebSocket-Protocol subprotocol (e.g. "token.<jwt>")
        // Note: ?token= query param auth was removed — it leaks tokens in logs/history/referrers
        let authUser: { userId: string; role: string; displayName: string } | undefined;
        if (this.authService) {
          const protocols = request.headers['sec-websocket-protocol'];
          const token =
            typeof protocols === 'string'
              ? protocols
                  .split(',')
                  .map((p) => p.trim())
                  .find((p) => p.startsWith('token.'))
                  ?.slice(6)
              : undefined;

          if (!token) {
            socket.close(4401, 'Missing authentication token');
            return;
          }
          try {
            const user = await this.authService.validateToken(token);
            // Resolve display name: try soul users, fall back to role label
            let displayName = user.role === 'admin' ? 'Admin' : 'User';
            try {
              const soulManager = this.secureYeoman.getSoulManager();
              const soulUser = await soulManager.getUser(user.userId);
              if (soulUser?.name) displayName = soulUser.name;
            } catch {
              // Non-fatal: user may not have a soul profile
            }
            authUser = { userId: user.userId, role: user.role, displayName };
          } catch {
            socket.close(4401, 'Invalid authentication token');
            return;
          }
        } else {
          // No auth service configured (dev mode) — allow with placeholder identity
          authUser = { userId: 'dev', role: 'admin', displayName: 'Dev' };
        }

        // Validate docId format
        if (!/^(personality|skill):[0-9a-f-]{36}$/.test(docId)) {
          socket.close(4400, 'Invalid docId format');
          return;
        }

        socket.binaryType = 'arraybuffer';

        const clientId = `collab_${uuidv7()}`;

        // Resolve initial content from the soul manager so new rooms converge
        // immediately to the current REST-persisted value.
        let initialContent: string | undefined;
        try {
          const soulManager = this.secureYeoman.getSoulManager();
          if (docId.startsWith('personality:')) {
            const id = docId.slice('personality:'.length);
            const p = await soulManager.getPersonality(id);
            initialContent = p?.systemPrompt;
          } else if (docId.startsWith('skill:')) {
            const id = docId.slice('skill:'.length);
            const s = await soulManager.getSkill(id);
            initialContent = s?.instructions;
          }
        } catch {
          // Non-fatal
        }

        await this.collabManager.join(
          docId,
          clientId,
          socket,
          authUser.userId,
          authUser.displayName,
          initialContent
        );

        socket.on('message', (message: Buffer) => {
          const data = new Uint8Array(message instanceof ArrayBuffer ? message : message.buffer);
          this.collabManager.handleMessage(docId, clientId, data);
        });

        socket.on('close', () => {
          this.collabManager.leave(docId, clientId);
          this.getLogger().debug({ clientId, docId }, 'Collab client disconnected');
        });

        socket.on('error', (error: Error) => {
          this.getLogger().error(
            {
              clientId,
              docId,
              error: error.message,
            },
            'Collab WebSocket error'
          );
        });
      }
    );

    // ── Video stream WebSocket endpoint ──────────────────────────────────
    // Path: /ws/video/:sessionId — subscribe to real-time video frames
    this.app.get(
      '/ws/video/:sessionId',
      { websocket: true },
      async (socket, request: FastifyRequest<{ Params: { sessionId: string } }>) => {
        // Auth via Sec-WebSocket-Protocol subprotocol (same pattern as /ws/metrics)
        // Note: ?token= query param auth was removed — it leaks tokens in logs/history/referrers
        let authUser: { userId: string; role: string } | undefined;
        if (this.authService) {
          const protocols = request.headers['sec-websocket-protocol'];
          const token =
            typeof protocols === 'string'
              ? protocols
                  .split(',')
                  .map((p) => p.trim())
                  .find((p) => p.startsWith('token.'))
                  ?.slice(6)
              : undefined;
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

        // Security: video streaming must be enabled
        const security = this.secureYeoman.getConfig().security;
        if (!security.allowVideoStreaming || !security.allowDesktopControl) {
          socket.close(4403, 'Video streaming is disabled');
          return;
        }

        const vsm = this.secureYeoman.getVideoStreamManager();
        if (!vsm) {
          socket.close(4503, 'Video stream manager not initialized');
          return;
        }

        const { sessionId } = request.params;
        const session = vsm.getSession(sessionId);
        if (!session) {
          socket.close(4404, 'Session not found');
          return;
        }

        this.getLogger().debug(
          { sessionId, userId: authUser?.userId },
          'Video stream WebSocket client connected'
        );

        // Subscribe to frames
        const unsubFrame = vsm.subscribeFrames(sessionId, (frame) => {
          if (socket.readyState === 1 /* OPEN */) {
            try {
              socket.send(JSON.stringify({ type: 'frame', frame }));
            } catch {
              /* client gone */
            }
          }
        });

        const unsubSession = vsm.subscribeSession(sessionId, (event) => {
          if (socket.readyState === 1) {
            try {
              socket.send(JSON.stringify(event));
            } catch {
              /* client gone */
            }
          }
          if (event.type === 'session_stopped' || event.type === 'session_error') {
            socket.close(1000, 'Session ended');
          }
        });

        socket.on('close', () => {
          unsubFrame();
          unsubSession();
          this.getLogger().debug({ sessionId }, 'Video stream WebSocket client disconnected');
        });

        socket.on('error', (error: Error) => {
          this.getLogger().warn(
            { sessionId, error: error.message },
            'Video stream WebSocket error'
          );
          unsubFrame();
          unsubSession();
        });

        // Send initial session state
        socket.send(JSON.stringify({ type: 'session_started', session }));
      }
    );
  }

  /**
   * Resolve the dashboard dist path from options, env var, or conventional locations.
   * Returns null if no built dashboard is found (dev mode).
   */
  private resolveDashboardDist(): string | null {
    const candidates = [
      this.dashboardDist,
      this.config.dashboardDist,
      join(dirname(fileURLToPath(import.meta.url)), '../../../dashboard/dist'),
      '/usr/share/secureyeoman/dashboard',
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      if (existsSync(join(p, 'index.html'))) {
        return p;
      }
    }
    return null;
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
          this.getLogger().error(
            {
              clientId,
              channel,
              error: error instanceof Error ? error.message : 'Unknown',
            },
            'Failed to send WebSocket message'
          );
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

          // Evaluate alert rules against current snapshot (fire-and-forget)
          const alertManager = this.secureYeoman.getAlertManager?.();
          if (alertManager) {
            void alertManager.evaluate(metrics);
          }
        } catch (error) {
          this.getLogger().error(
            {
              error: error instanceof Error ? error.message : 'Unknown',
            },
            'Failed to broadcast metrics'
          );
        }
      })();
    }, intervalMs);

    this.metricsInterval.unref();
  }

  /**
   * Start periodic GPU telemetry broadcast (every 30 seconds)
   */
  private startGpuTelemetryBroadcast(): void {
    const gpuInterval = setInterval(() => {
      void (async () => {
        try {
          if (!this.hasSubscribers('gpu')) return;

          const { probeGpu } = await import('../ai/gpu-probe.js');
          const { refreshLocalModels } = await import('../ai/local-model-registry.js');
          const [gpu, localModels] = await Promise.all([probeGpu(), refreshLocalModels()]);

          this.broadcast('gpu', {
            gpu,
            localModels: {
              count: localModels.models.length,
              ollamaAvailable: localModels.ollamaAvailable,
              lmstudioAvailable: localModels.lmstudioAvailable,
              localaiAvailable: localModels.localaiAvailable,
              lastRefreshed: localModels.lastRefreshed,
            },
          });
        } catch (error) {
          this.getLogger().debug(
            { error: error instanceof Error ? error.message : 'Unknown' },
            'GPU telemetry broadcast skipped'
          );
        }
      })();
    }, 30_000);

    gpuInterval.unref();
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

      // Attach connection limiter to the underlying Node HTTP/HTTPS server.
      // Must happen after listen() so this.app.server is available.
      this.connectionLimiter.attach(this.app.server);

      const scheme = this.config.tls.enabled ? 'https' : 'http';
      this.getLogger().info(
        {
          host,
          port,
          url: `${scheme}://${host}:${port}`,
          tls: this.config.tls.enabled,
          mtls: !!(this.config.tls.enabled && this.config.tls.caPath),
        },
        'Gateway server started'
      );

      // Start metrics broadcast
      this.startMetricsBroadcast();

      // Start GPU telemetry broadcast
      this.startGpuTelemetryBroadcast();

      // Start WebSocket heartbeat (ping every 30s, terminate after 60s without pong)
      this.heartbeatInterval = setInterval(() => {
        const now = Date.now();
        for (const [id, client] of this.clients) {
          try {
            if (now - client.lastPong > 60_000) {
              client.ws.terminate();
              this.clients.delete(id);
            } else {
              client.ws.ping();
            }
          } catch {
            // Socket may already be closed/invalid — clean up silently
            this.clients.delete(id);
          }
        }
      }, 30_000);
      this.heartbeatInterval.unref();
    } catch (error) {
      this.getLogger().error(
        {
          error: error instanceof Error ? error.message : 'Unknown',
        },
        'Failed to start gateway server'
      );
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

    // Enter drain mode — new requests get 503 while in-flight requests complete.
    // Only wait when explicitly configured; default drain period of 0 skips the delay
    // so tests and simple deployments shut down instantly.
    const drainMs = this.config.backpressure?.drainPeriodMs ?? 0;
    if (drainMs > 0 && this.clients.size > 0) {
      this.backpressureManager.startDrain();
      this.getLogger().info(
        { drainMs, clients: this.clients.size },
        'Draining in-flight requests before shutdown'
      );
      await new Promise<void>((resolve) => setTimeout(resolve, drainMs));
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

    // Stop all security modules
    this.connectionLimiter.stop();
    this.ipReputationManager?.stop();
    this.requestFingerprinter?.stop();
    this.lowRateDetector?.stop();
    void this.adaptiveRateLimiter?.stop();
    this.backpressureManager.stop();
    if (this.pressureInterval) {
      clearInterval(this.pressureInterval);
      this.pressureInterval = null;
    }

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
