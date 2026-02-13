/**
 * Ollama Local Provider
 *
 * Fetch-based implementation — no external SDK dependency.
 * Communicates with Ollama's REST API at /api/chat.
 * Streaming via NDJSON (newline-delimited JSON) response parsing.
 */

import type {
  AIRequest,
  AIResponse,
  AIStreamChunk,
  AIMessage,
  ToolCall,
  TokenUsage,
  Tool,
  AIProviderName,
} from '@friday/shared';
import { BaseProvider, type ProviderConfig } from './base.js';
import { ProviderUnavailableError, InvalidResponseError } from '../errors.js';
import type { SecureLogger } from '../../logging/logger.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OllamaModelInfo {
  id: string;
  size: number;
}

export class OllamaProvider extends BaseProvider {
  readonly name: AIProviderName = 'ollama';
  private readonly baseUrl: string;

  constructor(config: ProviderConfig, logger?: SecureLogger) {
    super(config, logger);
    this.baseUrl = config.model.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * Fetch locally downloaded models from Ollama's tags API.
   */
  static async fetchAvailableModels(baseUrl = DEFAULT_BASE_URL): Promise<OllamaModelInfo[]> {
    try {
      const res = await fetch(`${baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name: string; size: number }> };
      return (data.models ?? []).map((m) => ({
        id: m.name,
        size: m.size,
      }));
    } catch {
      return [];
    }
  }

  protected async doChat(request: AIRequest): Promise<AIResponse> {
    const model = this.resolveModel(request);
    const body = this.buildRequestBody(request, model, false);

    const response = await this.fetchApi('/api/chat', body);
    const data = (await response.json()) as OllamaChatResponse;

    return this.mapResponse(data, model);
  }

  async *chatStream(request: AIRequest): AsyncGenerator<AIStreamChunk, void, unknown> {
    const model = this.resolveModel(request);
    const body = this.buildRequestBody(request, model, true);

    const response = await this.fetchApi('/api/chat', body);

    if (!response.body) {
      throw new InvalidResponseError('ollama', 'No response body for streaming');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          const chunk = JSON.parse(line) as OllamaChatResponse;

          if (chunk.message?.content) {
            yield { type: 'content_delta', content: chunk.message.content };
          }

          if (chunk.message?.tool_calls?.length) {
            for (const tc of chunk.message.tool_calls) {
              yield {
                type: 'tool_call_delta',
                toolCall: {
                  id: `ollama-${Date.now()}`,
                  name: tc.function.name,
                },
              };
            }
          }

          if (chunk.done) {
            const usage: TokenUsage = {
              inputTokens: chunk.prompt_eval_count ?? 0,
              outputTokens: chunk.eval_count ?? 0,
              cachedTokens: 0,
              totalTokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
            };
            yield { type: 'done', stopReason: 'end_turn', usage };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private buildRequestBody(
    request: AIRequest,
    model: string,
    stream: boolean,
  ): Record<string, unknown> {
    return {
      model,
      messages: this.mapMessages(request.messages),
      stream,
      options: {
        temperature: this.resolveTemperature(request),
        num_predict: this.resolveMaxTokens(request),
        ...(request.stopSequences?.length ? { stop: request.stopSequences } : {}),
      },
      ...(request.tools?.length ? { tools: this.mapTools(request.tools) } : {}),
    };
  }

  private mapMessages(messages: AIMessage[]): OllamaMessage[] {
    return messages.map((msg): OllamaMessage => {
      if (msg.role === 'tool' && msg.toolResult) {
        return {
          role: 'tool',
          content: msg.toolResult.content,
        };
      }

      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        return {
          role: 'assistant',
          content: msg.content ?? '',
          tool_calls: msg.toolCalls.map((tc) => ({
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
      }

      return {
        role: msg.role as OllamaMessage['role'],
        content: msg.content ?? '',
      };
    });
  }

  private mapTools(tools: Tool[]): OllamaTool[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: t.parameters as Record<string, unknown>,
      },
    }));
  }

  private mapResponse(data: OllamaChatResponse, model: string): AIResponse {
    const toolCalls: ToolCall[] = [];

    if (data.message.tool_calls?.length) {
      for (const tc of data.message.tool_calls) {
        toolCalls.push({
          id: `ollama-${Date.now()}-${toolCalls.length}`,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
    }

    const usage: TokenUsage = {
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      cachedTokens: 0,
      totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
    };

    return {
      id: `ollama-${Date.now()}`,
      content: data.message.content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      model,
      provider: 'ollama',
    };
  }

  private async fetchApi(path: string, body: Record<string, unknown>): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.modelConfig.requestTimeoutMs),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new InvalidResponseError('ollama', `Model not found: ${body.model as string}`);
        }
        throw new ProviderUnavailableError('ollama', response.status);
      }

      return response;
    } catch (error) {
      if (error instanceof InvalidResponseError || error instanceof ProviderUnavailableError) {
        throw error;
      }

      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        throw new ProviderUnavailableError('ollama', undefined, error instanceof Error ? error : undefined);
      }
      throw error;
    }
  }
}
