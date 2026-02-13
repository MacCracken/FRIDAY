/**
 * Anthropic Claude Provider
 *
 * Uses the @anthropic-ai/sdk package (already installed).
 * Maps native tool_use blocks to the unified ToolCall format.
 * Reads cache_read_input_tokens for cached token tracking.
 */

import Anthropic from '@anthropic-ai/sdk';
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
import {
  RateLimitError,
  TokenLimitError,
  AuthenticationError,
  ProviderUnavailableError,
  InvalidResponseError,
} from '../errors.js';
import type { SecureLogger } from '../../logging/logger.js';

export interface AnthropicModelInfo {
  id: string;
  displayName: string;
}

export class AnthropicProvider extends BaseProvider {
  readonly name: AIProviderName = 'anthropic';
  private readonly client: Anthropic;

  constructor(config: ProviderConfig, logger?: SecureLogger) {
    super(config, logger);
    this.client = new Anthropic({
      apiKey: this.apiKey,
      timeout: this.modelConfig.requestTimeoutMs,
    });
  }

  /**
   * Fetch available models from Anthropic's Models API.
   * Filters to claude-* models only.
   */
  static async fetchAvailableModels(apiKey: string): Promise<AnthropicModelInfo[]> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
      return (data.data ?? [])
        .filter((m) => m.id.startsWith('claude-'))
        .map((m) => ({
          id: m.id,
          displayName: m.display_name ?? m.id,
        }));
    } catch {
      return [];
    }
  }

  protected async doChat(request: AIRequest): Promise<AIResponse> {
    try {
      const { system, messages } = this.mapMessages(request.messages);
      const model = this.resolveModel(request);

      const params: Anthropic.MessageCreateParams = {
        model,
        max_tokens: this.resolveMaxTokens(request),
        temperature: this.resolveTemperature(request),
        messages,
        ...(system ? { system } : {}),
        ...(request.tools?.length ? { tools: this.mapTools(request.tools) } : {}),
        ...(request.stopSequences?.length ? { stop_sequences: request.stopSequences } : {}),
      };

      const response = await this.client.messages.create(params);

      return this.mapResponse(response, model);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async *chatStream(request: AIRequest): AsyncGenerator<AIStreamChunk, void, unknown> {
    const { system, messages } = this.mapMessages(request.messages);
    const model = this.resolveModel(request);

    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: this.resolveMaxTokens(request),
      temperature: this.resolveTemperature(request),
      messages,
      stream: true,
      ...(system ? { system } : {}),
      ...(request.tools?.length ? { tools: this.mapTools(request.tools) } : {}),
      ...(request.stopSequences?.length ? { stop_sequences: request.stopSequences } : {}),
    };

    try {
      const stream = this.client.messages.stream(params);

      let currentToolId = '';
      let currentToolName = '';
      let currentToolArgs = '';

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if ('text' in delta && delta.type === 'text_delta') {
            yield { type: 'content_delta', content: delta.text };
          } else if ('partial_json' in delta && delta.type === 'input_json_delta') {
            currentToolArgs += delta.partial_json;
            yield {
              type: 'tool_call_delta',
              toolCall: { id: currentToolId, name: currentToolName },
            };
          }
        } else if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            currentToolId = block.id;
            currentToolName = block.name;
            currentToolArgs = '';
          }
        } else if (event.type === 'message_delta') {
          const finalMessage = await stream.finalMessage();
          const usage = this.mapUsage(finalMessage.usage);
          yield {
            type: 'done',
            stopReason: this.mapStopReason(finalMessage.stop_reason),
            usage,
          };
        }
      }
    } catch (error) {
      throw this.mapError(error);
    }
  }

  // ─── Mapping Helpers ─────────────────────────────────────────

  private mapMessages(messages: AIMessage[]): {
    system: string | undefined;
    messages: Anthropic.MessageParam[];
  } {
    let system: string | undefined;
    const mapped: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
        continue;
      }

      if (msg.role === 'tool' && msg.toolResult) {
        mapped.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolResult.toolCallId,
              content: msg.toolResult.content,
              is_error: msg.toolResult.isError,
            },
          ],
        });
        continue;
      }

      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const content: Anthropic.ContentBlock[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments as Record<string, unknown>,
          });
        }
        mapped.push({ role: 'assistant', content });
        continue;
      }

      mapped.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content ?? '',
      });
    }

    return { system, messages: mapped };
  }

  private mapTools(tools: Tool[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
    }));
  }

  private mapResponse(response: Anthropic.Message, model: string): AIResponse {
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      id: response.id,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: this.mapUsage(response.usage),
      stopReason: this.mapStopReason(response.stop_reason),
      model,
      provider: 'anthropic',
    };
  }

  private mapUsage(usage: Anthropic.Usage): TokenUsage {
    const usageRecord = usage as unknown as Record<string, unknown>;
    const cached = usageRecord.cache_read_input_tokens as number | undefined;
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cachedTokens: cached ?? 0,
      totalTokens: usage.input_tokens + usage.output_tokens,
    };
  }

  private mapStopReason(reason: string | null): AIResponse['stopReason'] {
    switch (reason) {
      case 'end_turn':
        return 'end_turn';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      case 'stop_sequence':
        return 'stop_sequence';
      default:
        return 'end_turn';
    }
  }

  private mapError(error: unknown): Error {
    if (error instanceof Anthropic.APIError) {
      if (error.status === 429) {
        const retryAfter = (error.headers as Record<string, string> | undefined)?.['retry-after'];
        return new RateLimitError(
          'anthropic',
          retryAfter ? parseInt(retryAfter, 10) : undefined,
          error
        );
      }
      if (error.status === 401) {
        return new AuthenticationError('anthropic', error);
      }
      if (error.status === 400 && error.message.includes('token')) {
        return new TokenLimitError('anthropic', error);
      }
      if (error.status === 502 || error.status === 503 || error.status === 529) {
        return new ProviderUnavailableError('anthropic', error.status, error);
      }
      return new InvalidResponseError('anthropic', error.message, error);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
