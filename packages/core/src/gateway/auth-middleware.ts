/**
 * Auth Middleware — Fastify onRequest hooks for JWT / API-key auth and RBAC.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthService, AuthUser } from '../security/auth.js';
import { AuthError } from '../security/auth.js';
import type { RBAC } from '../security/rbac.js';
import type { AuditChain } from '../logging/audit-chain.js';
import type { SecureLogger } from '../logging/logger.js';

// ── Fastify augmentation ─────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

// ── Route permission map ─────────────────────────────────────────────

interface RoutePermission {
  resource: string;
  action: string;
}

const ROUTE_PERMISSIONS: Record<string, Record<string, RoutePermission>> = {
  '/api/v1/metrics': {
    GET: { resource: 'metrics', action: 'read' },
  },
  '/api/v1/tasks': {
    GET: { resource: 'tasks', action: 'read' },
  },
  '/api/v1/tasks/:id': {
    GET: { resource: 'tasks', action: 'read' },
  },
  '/api/v1/audit': {
    GET: { resource: 'audit', action: 'read' },
  },
  '/api/v1/audit/verify': {
    POST: { resource: 'audit', action: 'verify' },
  },
  '/api/v1/security/events': {
    GET: { resource: 'security_events', action: 'read' },
  },
  '/api/v1/auth/api-keys': {
    POST: { resource: '*', action: '*' },
    GET: { resource: '*', action: '*' },
  },
  '/api/v1/auth/api-keys/:id': {
    DELETE: { resource: '*', action: '*' },
  },
  // Soul routes
  '/api/v1/soul/personality': {
    GET: { resource: 'soul', action: 'read' },
  },
  '/api/v1/soul/personalities': {
    GET: { resource: 'soul', action: 'read' },
    POST: { resource: 'soul', action: 'write' },
  },
  '/api/v1/soul/personalities/:id': {
    PUT: { resource: 'soul', action: 'write' },
    DELETE: { resource: 'soul', action: 'write' },
  },
  '/api/v1/soul/personalities/:id/activate': {
    POST: { resource: 'soul', action: 'write' },
  },
  '/api/v1/soul/skills': {
    GET: { resource: 'soul', action: 'read' },
    POST: { resource: 'soul', action: 'write' },
  },
  '/api/v1/soul/skills/:id': {
    PUT: { resource: 'soul', action: 'write' },
    DELETE: { resource: 'soul', action: 'write' },
  },
  '/api/v1/soul/skills/:id/enable': {
    POST: { resource: 'soul', action: 'write' },
  },
  '/api/v1/soul/skills/:id/disable': {
    POST: { resource: 'soul', action: 'write' },
  },
  '/api/v1/soul/skills/:id/approve': {
    POST: { resource: 'soul', action: 'write' },
  },
  '/api/v1/soul/skills/:id/reject': {
    POST: { resource: 'soul', action: 'write' },
  },
  '/api/v1/soul/prompt/preview': {
    GET: { resource: 'soul', action: 'read' },
  },
  '/api/v1/soul/config': {
    GET: { resource: 'soul', action: 'read' },
  },
  '/api/v1/soul/onboarding/status': {
    GET: { resource: 'soul', action: 'read' },
  },
  '/api/v1/soul/onboarding/complete': {
    POST: { resource: 'soul', action: 'write' },
  },
};

const PUBLIC_ROUTES = new Set(['/health', '/api/v1/auth/login']);
const TOKEN_ONLY_ROUTES = new Set(['/api/v1/auth/refresh', '/api/v1/auth/logout']);

// ── Helpers ──────────────────────────────────────────────────────────

function routeKey(request: FastifyRequest): string {
  // Fastify stores the route schema path (with :param placeholders) in routeOptions
  return (request.routeOptions?.url ?? request.url.split('?')[0]) as string;
}

// ── Auth extraction hook ─────────────────────────────────────────────

export interface AuthHookOptions {
  authService: AuthService;
  logger: SecureLogger;
}

export function createAuthHook(opts: AuthHookOptions) {
  return async function authHook(request: FastifyRequest, reply: FastifyReply) {
    const path = routeKey(request);

    if (PUBLIC_ROUTES.has(path)) return;

    // Try Bearer token
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        request.authUser = await opts.authService.validateToken(token);
        return;
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        return reply.code(401).send({ error: 'Authentication failed' });
      }
    }

    // Try API key
    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      try {
        request.authUser = await opts.authService.validateApiKey(apiKey);
        return;
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        return reply.code(401).send({ error: 'Authentication failed' });
      }
    }

    return reply.code(401).send({ error: 'Missing authentication credentials' });
  };
}

// ── RBAC enforcement hook ────────────────────────────────────────────

export interface RbacHookOptions {
  rbac: RBAC;
  auditChain: AuditChain;
  logger: SecureLogger;
}

export function createRbacHook(opts: RbacHookOptions) {
  return async function rbacHook(request: FastifyRequest, reply: FastifyReply) {
    const path = routeKey(request);

    // Skip public + token-only routes
    if (PUBLIC_ROUTES.has(path) || TOKEN_ONLY_ROUTES.has(path)) return;

    const user = request.authUser;
    if (!user) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    // Look up required permission
    const methodMap = ROUTE_PERMISSIONS[path];
    const perm = methodMap?.[request.method];

    if (!perm) {
      // Unmapped route — admin only (default-deny)
      if (user.role !== 'admin') {
        await auditDenial(opts, user, path, request.method);
        return reply.code(403).send({ error: 'Forbidden' });
      }
      return;
    }

    const result = opts.rbac.checkPermission(user.role, {
      resource: perm.resource,
      action: perm.action,
    }, user.userId);

    if (!result.granted) {
      await auditDenial(opts, user, path, request.method);
      return reply.code(403).send({ error: 'Forbidden' });
    }
  };
}

async function auditDenial(
  opts: RbacHookOptions,
  user: AuthUser,
  path: string,
  method: string,
): Promise<void> {
  try {
    await opts.auditChain.record({
      event: 'permission_denied',
      level: 'warn',
      message: `RBAC denied ${method} ${path}`,
      userId: user.userId,
      metadata: { role: user.role, path, method },
    });
  } catch {
    opts.logger.error('Failed to audit RBAC denial');
  }
}
