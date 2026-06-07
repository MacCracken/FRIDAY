/**
 * Gateway Routes — API Gateway mode for Phase 80.
 *
 * Exposes the chat pipeline as an authenticated REST API with:
 * - Per-key RPM rate limiting (sliding 60s window)
 * - Per-key daily token quota (TPD)
 * - Per-key personality binding
 * - Usage recording (auth.api_key_usage)
 * - Analytics endpoints
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sendError, toErrorMessage } from '../utils/errors.js';
import type { AuthStorage } from '../security/auth-storage.js';
import type { SecureYeoman } from '../secureyeoman.js';

export interface GatewayRoutesOptions {
  secureYeoman: SecureYeoman;
  authStorage: AuthStorage;
}

// In-memory RPM tracker — sliding 60-second window per API key
const rpmWindows = new Map<string, { count: number; windowStart: number }>();

function checkRpm(keyId: string, limitRpm: number): boolean {
  const now = Date.now();
  const window = rpmWindows.get(keyId);
  if (!window || now - window.windowStart >= 60_000) {
    rpmWindows.set(keyId, { count: 1, windowStart: now });
    return true; // allowed
  }
  if (window.count >= limitRpm) {
    return false; // rate limited
  }
  window.count++;
  return true;
}

export function registerGatewayRoutes(app: FastifyInstance, opts: GatewayRoutesOptions): void {
  const { authStorage } = opts;

  // ── Main gateway endpoint ─────────────────────────────────────────────────

  app.post(
    '/api/v1/gateway',
    async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
      const authUser = request.authUser;
      if (!authUser) {
        return sendError(reply, 401, 'Not authenticated');
      }

      const start = Date.now();
      const usageAccumulator = { tokensUsed: 0 };

      // 1. RPM enforcement
      if (authUser.gatewayRateLimitRpm) {
        const allowed = checkRpm(authUser.apiKeyId!, authUser.gatewayRateLimitRpm);
        if (!allowed) {
          reply.header('Retry-After', '60');
          return sendError(reply, 429, 'Rate limit exceeded — try again in 60 seconds');
        }
      }

      // 2. TPD enforcement
      if (authUser.gatewayRateLimitTpd && authUser.apiKeyId) {
        const tokensToday = await authStorage.getTokensUsedToday(authUser.apiKeyId);
        if (tokensToday >= authUser.gatewayRateLimitTpd) {
          return sendError(reply, 429, 'Daily token quota exhausted');
        }
      }

      // 3. Resolve personality (key binding takes precedence)
      const body = Object.fromEntries(
        Object.entries(request.body).filter(
          ([k]) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype'
        )
      );
      if (authUser.gatewayPersonalityId) {
        body.personalityId = authUser.gatewayPersonalityId;
      }

      // 4. Delegate to chat pipeline via internal request

      let statusCode = 200;
      try {
        // Forward to the chat endpoint internally
        const chatResponse = await app.inject({
          method: 'POST',
          url: '/api/v1/chat',
          headers: {
            'content-type': 'application/json',
            authorization: request.headers.authorization ?? '',
          },
          payload: JSON.stringify(body),
        });

        statusCode = chatResponse.statusCode;

        // Try to extract token usage from response
        try {
          const parsed = JSON.parse(chatResponse.body);
          if (typeof parsed?.tokensUsed === 'number') {
            usageAccumulator.tokensUsed = parsed.tokensUsed;
          }
        } catch {
          // ignore parse errors
        }

        reply.code(chatResponse.statusCode);
        for (const [k, v] of Object.entries(chatResponse.headers)) {
          if (k !== 'content-length') {
            reply.header(k, v);
          }
        }
        return reply.send(chatResponse.rawPayload);
      } catch (err) {
        statusCode = 500;
        return sendError(reply, 500, toErrorMessage(err));
      } finally {
        // 5. Record usage (fire & forget)
        if (authUser.apiKeyId) {
          authStorage
            .recordKeyUsage({
              key_id: authUser.apiKeyId,
              timestamp: Date.now(),
              tokens_used: usageAccumulator.tokensUsed,
              latency_ms: Date.now() - start,
              personality_id: (body.personalityId as string) ?? null,
              status_code: statusCode,
              error_message: null,
            })
            .catch(() => {
              /* fire-and-forget usage recording; non-critical */
            });
        }
      }
    }
  );

  // ── Analytics endpoints ───────────────────────────────────────────────────

  // Per-key usage rows
  app.get(
    '/api/v1/auth/api-keys/:id/usage',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { from?: string; to?: string };
      }>,
      reply
    ) => {
      try {
        const fromTs = request.query.from ? parseInt(request.query.from, 10) : undefined;
        const toTs = request.query.to ? parseInt(request.query.to, 10) : undefined;
        const rows = await authStorage.getKeyUsage(request.params.id, fromTs, toTs);
        return reply.send({ usage: rows });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );

  // Aggregate usage summary (admin)
  app.get(
    '/api/v1/auth/api-keys/usage/summary',
    async (request: FastifyRequest<{ Querystring: { format?: string } }>, reply) => {
      try {
        const summary = await authStorage.getUsageSummary();

        if (request.query.format === 'csv') {
          const lines = [
            'keyId,keyPrefix,personalityId,requests24h,tokens24h,errors24h,p50LatencyMs,p95LatencyMs',
            ...summary.map((r) =>
              [
                r.keyId,
                r.keyPrefix,
                r.personalityId ?? '',
                r.requests24h,
                r.tokens24h,
                r.errors24h,
                r.p50LatencyMs,
                r.p95LatencyMs,
              ].join(',')
            ),
          ];
          return reply
            .header('Content-Type', 'text/csv')
            .header('Content-Disposition', 'attachment; filename="api-key-usage.csv"')
            .send(lines.join('\n'));
        }

        return reply.send({ summary });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );
}
