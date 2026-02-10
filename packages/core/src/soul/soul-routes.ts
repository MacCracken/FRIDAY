/**
 * Soul Routes — API endpoints for personality and skill management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SoulManager } from './manager.js';
import type { PersonalityCreate, PersonalityUpdate, SkillCreate, SkillUpdate } from './types.js';

export interface SoulRoutesOptions {
  soulManager: SoulManager;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export function registerSoulRoutes(
  app: FastifyInstance,
  opts: SoulRoutesOptions,
): void {
  const { soulManager } = opts;

  // ── Personality ─────────────────────────────────────────────

  app.get('/api/v1/soul/personality', async () => {
    const personality = soulManager.getActivePersonality();
    return { personality };
  });

  app.get('/api/v1/soul/personalities', async () => {
    const personalities = soulManager.listPersonalities();
    return { personalities };
  });

  app.post('/api/v1/soul/personalities', async (
    request: FastifyRequest<{ Body: PersonalityCreate }>,
    reply: FastifyReply,
  ) => {
    try {
      const personality = soulManager.createPersonality(request.body);
      return reply.code(201).send({ personality });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  app.put('/api/v1/soul/personalities/:id', async (
    request: FastifyRequest<{ Params: { id: string }; Body: PersonalityUpdate }>,
    reply: FastifyReply,
  ) => {
    try {
      const personality = soulManager.updatePersonality(request.params.id, request.body);
      return { personality };
    } catch (err) {
      return reply.code(404).send({ error: errorMessage(err) });
    }
  });

  app.delete('/api/v1/soul/personalities/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      soulManager.deletePersonality(request.params.id);
      return { message: 'Personality deleted' };
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  app.post('/api/v1/soul/personalities/:id/activate', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      soulManager.setPersonality(request.params.id);
      const personality = soulManager.getActivePersonality();
      return { personality };
    } catch (err) {
      return reply.code(404).send({ error: errorMessage(err) });
    }
  });

  // ── Skills ──────────────────────────────────────────────────

  app.get('/api/v1/soul/skills', async (
    request: FastifyRequest<{ Querystring: { status?: string; source?: string } }>,
  ) => {
    const { status, source } = request.query;
    const skills = soulManager.listSkills({ status, source });
    return { skills };
  });

  app.post('/api/v1/soul/skills', async (
    request: FastifyRequest<{ Body: SkillCreate }>,
    reply: FastifyReply,
  ) => {
    try {
      const skill = soulManager.createSkill(request.body);
      return reply.code(201).send({ skill });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  app.put('/api/v1/soul/skills/:id', async (
    request: FastifyRequest<{ Params: { id: string }; Body: SkillUpdate }>,
    reply: FastifyReply,
  ) => {
    try {
      const skill = soulManager.updateSkill(request.params.id, request.body);
      return { skill };
    } catch (err) {
      return reply.code(404).send({ error: errorMessage(err) });
    }
  });

  app.delete('/api/v1/soul/skills/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      soulManager.deleteSkill(request.params.id);
      return { message: 'Skill deleted' };
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  app.post('/api/v1/soul/skills/:id/enable', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      soulManager.enableSkill(request.params.id);
      return { message: 'Skill enabled' };
    } catch (err) {
      return reply.code(404).send({ error: errorMessage(err) });
    }
  });

  app.post('/api/v1/soul/skills/:id/disable', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      soulManager.disableSkill(request.params.id);
      return { message: 'Skill disabled' };
    } catch (err) {
      return reply.code(404).send({ error: errorMessage(err) });
    }
  });

  app.post('/api/v1/soul/skills/:id/approve', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      const skill = soulManager.approveSkill(request.params.id);
      return { skill };
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  app.post('/api/v1/soul/skills/:id/reject', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      soulManager.rejectSkill(request.params.id);
      return { message: 'Skill rejected' };
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  // ── Prompt Preview ──────────────────────────────────────────

  app.get('/api/v1/soul/prompt/preview', async () => {
    const prompt = soulManager.composeSoulPrompt();
    const tools = soulManager.getActiveTools();
    return { prompt, tools, charCount: prompt.length, estimatedTokens: Math.ceil(prompt.length / 4) };
  });

  // ── Config ──────────────────────────────────────────────────

  app.get('/api/v1/soul/config', async () => {
    const config = soulManager.getConfig();
    return { config };
  });

  // ── Agent Name ─────────────────────────────────────────────

  app.get('/api/v1/soul/agent-name', async () => {
    const agentName = soulManager.getAgentName();
    return { agentName };
  });

  app.put('/api/v1/soul/agent-name', async (
    request: FastifyRequest<{ Body: { agentName: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      soulManager.setAgentName(request.body.agentName);
      return { agentName: soulManager.getAgentName() };
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  // ── Onboarding ──────────────────────────────────────────────

  app.get('/api/v1/soul/onboarding/status', async () => {
    const needed = soulManager.needsOnboarding();
    const agentName = soulManager.getAgentName();
    const personality = soulManager.getActivePersonality();
    return { needed, agentName, personality };
  });

  app.post('/api/v1/soul/onboarding/complete', async (
    request: FastifyRequest<{ Body: Partial<PersonalityCreate> & { agentName?: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      // Step 1: Set agent name (first item in onboarding)
      const agentName = request.body?.agentName ?? request.body?.name ?? 'FRIDAY';
      soulManager.setAgentName(agentName);

      const defaults = {
        name: agentName,
        description: 'Friendly, Reliable, Intelligent Digital Assistant Yeoman',
        systemPrompt:
          `You are ${agentName}, a helpful and security-conscious AI assistant. You are direct, technically precise, and proactive about identifying risks.`,
        traits: { formality: 'balanced', humor: 'subtle', verbosity: 'concise' },
        sex: 'unspecified' as const,
        voice: '',
        preferredLanguage: '',
      };

      const data: PersonalityCreate = {
        name: request.body?.name ?? defaults.name,
        description: request.body?.description ?? defaults.description,
        systemPrompt: request.body?.systemPrompt ?? defaults.systemPrompt,
        traits: request.body?.traits ?? defaults.traits,
        sex: request.body?.sex ?? defaults.sex,
        voice: request.body?.voice ?? defaults.voice,
        preferredLanguage: request.body?.preferredLanguage ?? defaults.preferredLanguage,
      };

      const personality = soulManager.createPersonality(data);
      soulManager.setPersonality(personality.id);

      return reply.code(201).send({
        agentName: soulManager.getAgentName(),
        personality: soulManager.getActivePersonality(),
      });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });
}
