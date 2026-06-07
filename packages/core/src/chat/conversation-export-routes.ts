/**
 * Conversation Export & Share Routes
 *
 * - GET  /api/v1/conversations/:id/export?format=markdown|json|text  — download a conversation
 * - POST /api/v1/conversations/:id/share                            — create a share link (JWT)
 * - GET  /api/v1/conversations/shared/:token                        — retrieve shared conversation (no auth)
 * - DELETE /api/v1/conversations/:id/share                          — revoke share (token blacklist)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import type { ConversationStorage } from './conversation-storage.js';
import type { Conversation, ConversationMessage } from './conversation-storage.js';
import { sendError } from '../utils/errors.js';

export type ExportFormat = 'markdown' | 'json' | 'text';

const SHARE_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

// In-memory revocation set. In a production cluster this would be backed by
// Redis or a DB table, but for the MVP a process-local Set is sufficient.
const revokedShareIds = new Set<string>();

// ── Formatters ─────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  return new Date(ts)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');
}

export function formatAsMarkdown(
  conversation: Conversation,
  messages: ConversationMessage[]
): string {
  const lines: string[] = [];
  lines.push(`# ${conversation.title}`);
  lines.push('');
  lines.push(`*Exported ${formatTimestamp(Date.now())}*`);
  lines.push('');

  for (const msg of messages) {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    lines.push(`### ${roleLabel}`);
    if (msg.model) {
      lines.push(`*Model: ${msg.model}*`);
    }
    lines.push('');
    lines.push(msg.content);
    lines.push('');
    lines.push(`---`);
    lines.push('');
  }

  return lines.join('\n');
}

export function formatAsText(conversation: Conversation, messages: ConversationMessage[]): string {
  const lines: string[] = [];
  lines.push(conversation.title);
  lines.push('='.repeat(conversation.title.length));
  lines.push('');

  for (const msg of messages) {
    const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
    lines.push(`[${roleLabel}]`);
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}

export function formatAsJson(
  conversation: Conversation,
  messages: ConversationMessage[]
): Record<string, unknown> {
  return {
    id: conversation.id,
    title: conversation.title,
    personalityId: conversation.personalityId,
    messageCount: conversation.messageCount,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    exportedAt: Date.now(),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      model: m.model,
      provider: m.provider,
      tokensUsed: m.tokensUsed,
      createdAt: m.createdAt,
    })),
  };
}

// ── Helpers ────────────────────────────────────────────────────

function getShareSecret(): Uint8Array {
  const secret = process.env.SHARE_JWT_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('SHARE_JWT_SECRET or JWT_SECRET must be set for share links');
  }
  return new TextEncoder().encode(secret);
}

// ── Route Registration ────────────────────────────────────────

export interface ConversationExportRoutesOptions {
  conversationStorage: ConversationStorage;
}

export function registerConversationExportRoutes(
  app: FastifyInstance,
  opts: ConversationExportRoutesOptions
): void {
  const { conversationStorage } = opts;

  // ── Export (download) ────────────────────────────────────────

  app.get(
    '/api/v1/conversations/:id/export',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { format?: string };
      }>,
      reply: FastifyReply
    ) => {
      const format = (request.query.format ?? 'markdown') as ExportFormat;
      if (!['markdown', 'json', 'text'].includes(format)) {
        return sendError(reply, 400, `Invalid format: ${format}. Use markdown, json, or text.`);
      }

      const conversation = await conversationStorage.getConversation(request.params.id);
      if (!conversation) {
        return sendError(reply, 404, 'Conversation not found');
      }

      const messages = await conversationStorage.getMessages(request.params.id);

      const safeTitle = conversation.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);

      switch (format) {
        case 'markdown': {
          const body = formatAsMarkdown(conversation, messages);
          return reply
            .header('Content-Type', 'text/markdown; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${safeTitle}.md"`)
            .send(body);
        }
        case 'json': {
          const body = formatAsJson(conversation, messages);
          return reply
            .header('Content-Type', 'application/json; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${safeTitle}.json"`)
            .send(body);
        }
        case 'text': {
          const body = formatAsText(conversation, messages);
          return reply
            .header('Content-Type', 'text/plain; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${safeTitle}.txt"`)
            .send(body);
        }
      }
    }
  );

  // ── Create share link ────────────────────────────────────────

  app.post(
    '/api/v1/conversations/:id/share',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body?: { expiresInSeconds?: number };
      }>,
      reply: FastifyReply
    ) => {
      const conversation = await conversationStorage.getConversation(request.params.id);
      if (!conversation) {
        return sendError(reply, 404, 'Conversation not found');
      }

      const expiresIn = request.body?.expiresInSeconds ?? SHARE_EXPIRY_SECONDS;

      const secret = getShareSecret();
      const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

      const token = await new SignJWT({
        conversationId: request.params.id,
        type: 'conversation_share',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(expiresAt)
        .sign(secret);

      return reply.code(201).send({
        shareId: token,
        expiresAt: expiresAt * 1000, // milliseconds for frontend
        url: `/api/v1/conversations/shared/${token}`,
      });
    }
  );

  // ── Retrieve shared conversation (public — no auth) ──────────

  app.get(
    '/api/v1/conversations/shared/*',
    async (request: FastifyRequest<{ Params: { '*': string } }>, reply: FastifyReply) => {
      const token = request.params['*'];

      if (revokedShareIds.has(token)) {
        return sendError(reply, 410, 'Share link has been revoked');
      }

      let payload: { conversationId?: string; type?: string };
      try {
        const secret = getShareSecret();
        const { payload: p } = await jwtVerify(token, secret);
        payload = p as typeof payload;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Invalid token';
        if (message.includes('exp') || message.includes('expired')) {
          return sendError(reply, 410, 'Share link has expired');
        }
        return sendError(reply, 401, 'Invalid share token');
      }

      if (payload.type !== 'conversation_share' || !payload.conversationId) {
        return sendError(reply, 401, 'Invalid share token');
      }

      const conversation = await conversationStorage.getConversation(payload.conversationId);
      if (!conversation) {
        return sendError(reply, 404, 'Conversation not found');
      }

      const messages = await conversationStorage.getMessages(payload.conversationId);
      return { ...conversation, messages };
    }
  );

  // ── Revoke share link ────────────────────────────────────────

  app.delete(
    '/api/v1/conversations/:id/share',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body?: { shareId?: string };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body;
      if (!body?.shareId) {
        return sendError(reply, 400, 'shareId is required in the request body');
      }

      revokedShareIds.add(body.shareId);
      return reply.code(204).send();
    }
  );
}

// Exposed for testing
export function _revokedShareIds(): Set<string> {
  return revokedShareIds;
}
