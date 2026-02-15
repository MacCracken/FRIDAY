/**
 * Conversation Routes — CRUD for persistent chat conversations.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ConversationStorage } from './conversation-storage.js';

export interface ConversationRoutesOptions {
  conversationStorage: ConversationStorage;
}

export function registerConversationRoutes(
  app: FastifyInstance,
  opts: ConversationRoutesOptions,
): void {
  const { conversationStorage } = opts;

  // List conversations (paginated, sorted by updated_at DESC)
  app.get(
    '/api/v1/conversations',
    async (
      request: FastifyRequest<{
        Querystring: { limit?: string; offset?: string };
      }>,
    ) => {
      const limit = request.query.limit ? Number(request.query.limit) : 50;
      const offset = request.query.offset ? Number(request.query.offset) : 0;
      return conversationStorage.listConversations({ limit, offset });
    },
  );

  // Create conversation
  app.post(
    '/api/v1/conversations',
    async (
      request: FastifyRequest<{
        Body: { title: string; personalityId?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { title, personalityId } = request.body;
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return reply.code(400).send({ error: 'Title is required' });
      }
      const conversation = conversationStorage.createConversation({
        title: title.trim(),
        personalityId,
      });
      return reply.code(201).send(conversation);
    },
  );

  // Get conversation with messages
  app.get(
    '/api/v1/conversations/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { limit?: string; offset?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const conversation = conversationStorage.getConversation(request.params.id);
      if (!conversation) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }
      const limit = request.query.limit ? Number(request.query.limit) : 1000;
      const offset = request.query.offset ? Number(request.query.offset) : 0;
      const messages = conversationStorage.getMessages(request.params.id, { limit, offset });
      return { ...conversation, messages };
    },
  );

  // Rename conversation
  app.put(
    '/api/v1/conversations/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { title: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { title } = request.body;
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return reply.code(400).send({ error: 'Title is required' });
      }
      try {
        const conversation = conversationStorage.updateConversation(request.params.id, {
          title: title.trim(),
        });
        return conversation;
      } catch {
        return reply.code(404).send({ error: 'Conversation not found' });
      }
    },
  );

  // Delete conversation (CASCADE deletes messages)
  app.delete(
    '/api/v1/conversations/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply,
    ) => {
      const deleted = conversationStorage.deleteConversation(request.params.id);
      if (!deleted) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }
      return { success: true };
    },
  );
}
