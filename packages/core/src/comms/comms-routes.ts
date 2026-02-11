/**
 * Comms Routes — API endpoints for agent-to-agent communication.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AgentComms } from './agent-comms.js';
import type { AgentIdentity, EncryptedMessage, MessagePayload } from './types.js';

export interface CommsRoutesOptions {
  agentComms: AgentComms;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export function registerCommsRoutes(
  app: FastifyInstance,
  opts: CommsRoutesOptions,
): void {
  const { agentComms } = opts;

  // ── Identity ─────────────────────────────────────────────────

  app.get('/api/v1/comms/identity', async () => {
    return agentComms.getIdentity();
  });

  // ── Peers ────────────────────────────────────────────────────

  app.get('/api/v1/comms/peers', async () => {
    const peers = agentComms.listPeers();
    return { peers };
  });

  app.post('/api/v1/comms/peers', async (
    request: FastifyRequest<{ Body: AgentIdentity }>,
    reply: FastifyReply,
  ) => {
    try {
      agentComms.addPeer(request.body);
      return reply.code(201).send({ message: 'Peer added' });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  app.delete('/api/v1/comms/peers/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const removed = agentComms.removePeer(request.params.id);
    if (!removed) {
      return reply.code(404).send({ error: 'Peer not found' });
    }
    return { message: 'Peer removed' };
  });

  // ── Messages ─────────────────────────────────────────────────

  app.post('/api/v1/comms/message', async (
    request: FastifyRequest<{ Body: EncryptedMessage }>,
    reply: FastifyReply,
  ) => {
    try {
      const payload = agentComms.decryptMessage(request.body);
      return { acknowledged: true, type: payload.type };
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  app.post('/api/v1/comms/send', async (
    request: FastifyRequest<{
      Body: { toAgentId: string; payload: MessagePayload }
    }>,
    reply: FastifyReply,
  ) => {
    try {
      const { toAgentId, payload } = request.body;
      const encrypted = agentComms.encryptMessage(toAgentId, payload);
      return reply.code(201).send({ message: encrypted });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  // ── Message Log ──────────────────────────────────────────────

  app.get('/api/v1/comms/log', async (
    request: FastifyRequest<{
      Querystring: { peerId?: string; type?: string; limit?: string }
    }>,
  ) => {
    const q = request.query;
    const log = agentComms.getMessageLog({
      peerId: q.peerId,
      type: q.type as import('./types.js').MessageType | undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { log };
  });
}
