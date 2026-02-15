/**
 * Chat Routes — Conversation with any personality via the dashboard.
 *
 * Accepts an optional `personalityId` to target a specific personality;
 * falls back to the active personality when omitted.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SecureYeoman } from '../secureyeoman.js';
import type { AIRequest, Tool } from '@friday/shared';
import type { McpToolDef } from '@friday/shared';

export interface ChatRoutesOptions {
  secureYeoman: SecureYeoman;
}

interface ChatRequestBody {
  message: string;
  history?: Array<{ role: string; content: string }>;
  personalityId?: string;
  saveAsMemory?: boolean;
}

interface RememberRequestBody {
  content: string;
  context?: Record<string, string>;
}

interface BrainContextMeta {
  memoriesUsed: number;
  knowledgeUsed: number;
  contextSnippets: string[];
}

export function registerChatRoutes(
  app: FastifyInstance,
  opts: ChatRoutesOptions,
): void {
  const { secureYeoman } = opts;

  app.post('/api/v1/chat', async (
    request: FastifyRequest<{ Body: ChatRequestBody }>,
    reply: FastifyReply,
  ) => {
    const { message, history, personalityId, saveAsMemory } = request.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return reply.code(400).send({ error: 'Message is required' });
    }

    let aiClient;
    try {
      aiClient = secureYeoman.getAIClient();
    } catch {
      return reply.code(503).send({
        error: 'AI client is not available. Check provider configuration and API keys.',
      });
    }

    // Gather Brain context metadata (best-effort — Brain may not be available)
    let brainContext: BrainContextMeta = { memoriesUsed: 0, knowledgeUsed: 0, contextSnippets: [] };
    try {
      const brainManager = secureYeoman.getBrainManager();
      const memories = brainManager.recall({ search: message, limit: 5 });
      const knowledge = brainManager.queryKnowledge({ search: message, limit: 5 });
      const snippets: string[] = [];
      for (const m of memories) snippets.push(`[${m.type}] ${m.content}`);
      for (const k of knowledge) snippets.push(`[${k.topic}] ${k.content}`);
      brainContext = {
        memoriesUsed: memories.length,
        knowledgeUsed: knowledge.length,
        contextSnippets: snippets,
      };
    } catch {
      // Brain not available — brainContext stays empty
    }

    const soulManager = secureYeoman.getSoulManager();
    const systemPrompt = soulManager.composeSoulPrompt(message, personalityId);

    const messages: AIRequest['messages'] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Append conversation history
    if (history && Array.isArray(history)) {
      for (const msg of history) {
        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        if (msg.content && typeof msg.content === 'string') {
          messages.push({ role, content: msg.content });
        }
      }
    }

    // Append the new user message
    messages.push({ role: 'user', content: message.trim() });

    // Collect tools from personality MCP config + skill tools
    const tools: Tool[] = [];

    // Skill-based tools
    tools.push(...soulManager.getActiveTools());

    // MCP tools filtered by personality config
    const personality = personalityId
      ? (soulManager.getPersonality(personalityId) ?? soulManager.getActivePersonality())
      : soulManager.getActivePersonality();

    const mcpClient = secureYeoman.getMcpClientManager();
    const mcpStorage = secureYeoman.getMcpStorage();

    if (personality?.body?.enabled && mcpClient && mcpStorage) {
      const selectedServers = personality.body.selectedServers ?? [];
      const perPersonalityFeatures = personality.body.mcpFeatures ?? { exposeGit: false, exposeFilesystem: false };
      const globalConfig = mcpStorage.getConfig();

      if (selectedServers.length > 0) {
        const allMcpTools: McpToolDef[] = mcpClient.getAllTools();

        for (const tool of allMcpTools) {
          // Only include tools from servers the personality has selected
          if (!selectedServers.includes(tool.serverName)) continue;

          // For YEOMAN MCP tools, apply per-personality AND global feature gates
          if (tool.serverName === 'YEOMAN MCP') {
            const isGitTool = tool.name.startsWith('git_') || tool.name.includes('git');
            const isFsTool = tool.name.startsWith('fs_') || tool.name.includes('filesystem') || tool.name.includes('file_');

            if (isGitTool && !(globalConfig.exposeGit && perPersonalityFeatures.exposeGit)) continue;
            if (isFsTool && !(globalConfig.exposeFilesystem && perPersonalityFeatures.exposeFilesystem)) continue;
          }

          tools.push({
            name: tool.name,
            description: tool.description || undefined,
            parameters: tool.inputSchema as Tool['parameters'],
          });
        }
      }
    }

    const aiRequest: AIRequest = {
      messages,
      stream: false,
      ...(tools.length > 0 ? { tools } : {}),
    };

    try {
      const response = await aiClient.chat(aiRequest, { source: 'dashboard_chat' });

      // Optionally store the exchange as an episodic memory
      if (saveAsMemory) {
        try {
          const brainManager = secureYeoman.getBrainManager();
          brainManager.remember(
            'episodic',
            `User: ${message.trim()}\nAssistant: ${response.content}`,
            'dashboard_chat',
            { personalityId: personalityId ?? 'default' },
          );
        } catch {
          // Brain not available — skip memory storage
        }
      }

      return {
        role: 'assistant' as const,
        content: response.content,
        model: response.model,
        provider: response.provider,
        tokensUsed: response.usage.totalTokens,
        brainContext,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(502).send({ error: `AI request failed: ${errMsg}` });
    }
  });

  // ── Remember endpoint — store a message as an episodic memory ──

  app.post('/api/v1/chat/remember', async (
    request: FastifyRequest<{ Body: RememberRequestBody }>,
    reply: FastifyReply,
  ) => {
    const { content, context } = request.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return reply.code(400).send({ error: 'Content is required' });
    }

    try {
      const brainManager = secureYeoman.getBrainManager();
      const memory = brainManager.remember('episodic', content.trim(), 'dashboard_chat', context);
      return { memory };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Brain is not available';
      return reply.code(503).send({ error: errMsg });
    }
  });
}
