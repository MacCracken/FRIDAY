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
    const { message, history, personalityId } = request.body;

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

      return {
        role: 'assistant' as const,
        content: response.content,
        model: response.model,
        provider: response.provider,
        tokensUsed: response.usage.totalTokens,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(502).send({ error: `AI request failed: ${message}` });
    }
  });
}
