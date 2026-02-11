/**
 * OpenAI GPT Provider
 *
 * Uses the `openai` package for chat completions.
 * Maps function_call/tool_calls to the unified ToolCall format.
 */

import OpenAI from 'openai';
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

export class OpenAIProvider extends BaseProvider {
  readonly name: AIProviderName = 'openai';
  private readonly client: OpenAI;

  constructor(config: ProviderConfig, logger?: SecureLogger) {
    super(config, logger);
    this.client = new OpenAI({
      apiKey: this.apiKey,
      timeout: this.modelConfig.requestTimeoutMs,
      ...(this.modelConfig.baseUrl ? { baseURL: this.modelConfig.baseUrl } : {}),
    });
  }

  protected async doChat(request: AIRequest): Promise<AIResponse> {
    try {
      const model = this.resolveModel(request);
      const messages = this.mapMessages(request.messages);

      const params: OpenAI.ChatCompletionCreateParams = {
        model,
        messages,
        max_tokens: this.resolveMaxTokens(request),
        temperature: this.resolveTemperature(request),
        ...(request.tools?.length ? { tools: this.mapTools(request.tools) } : {}),
        ...(request.stopSequences?.length ? { stop: request.stopSequences } : {}),
      };

      const response = await this.client.chat.completions.create(params);
      return this.mapResponse(response, model);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async *chatStream(request: AIRequest): AsyncGenerator<AIStreamChunk, void, unknown> {
    const model = this.resolveModel(request);
    const messages = this.mapMessages(request.messages);

    const params: OpenAI.ChatCompletionCreateParams = {
      model,
      messages,
      max_tokens: this.resolveMaxTokens(request),
      temperature: this.resolveTemperature(request),
      stream: true,
      stream_options: { include_usage: true },
      ...(request.tools?.length ? { tools: this.mapTools(request.tools) } : {}),
      ...(request.stopSequences?.length ? { stop: request.stopSequences } : {}),
    };

    try {
      const stream = await this.client.chat.completions.create(params);

      let currentToolId = '';
      let currentToolName = '';

      for await (const chunk of stream as AsyncIterable<OpenAI.ChatCompletionChunk>) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          yield { type: 'content_delta', content: delta.content };
        }

        if (delta?.tool_calls?.length) {
          for (const tc of delta.tool_calls) {
            if (tc.id) currentToolId = tc.id;
            if (tc.function?.name) currentToolName = tc.function.name;
            yield {
              type: 'tool_call_delta',
              toolCall: { id: currentToolId, name: currentToolName },
            };
          }
        }

        // Usage comes in the final chunk
        if (chunk.usage) {
          const usage = this.mapChunkUsage(chunk.usage);
          yield { type: 'usage', usage };
        }

        if (chunk.choices[0]?.finish_reason) {
          yield {
            type: 'done',
            stopReason: this.mapStopReason(chunk.choices[0].finish_reason),
          };
        }
      }
    } catch (error) {
      throw this.mapError(error);
    }
  }

  // ─── Mapping Helpers ─────────────────────────────────────────

  private mapMessages(messages: AIMessage[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((msg): OpenAI.ChatCompletionMessageParam => {
      if (msg.role === 'system') {
        return { role: 'system', content: msg.content ?? '' };
      }

      if (msg.role === 'tool' && msg.toolResult) {
        return {
          role: 'tool',
          tool_call_id: msg.toolResult.toolCallId,
          content: msg.toolResult.content,
        };
      }

      if (msg.role === 'assistant') {
        const toolCalls = msg.toolCalls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));

        return {
          role: 'assistant',
          content: msg.content ?? null,
          ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
        };
      }

      return { role: 'user', content: msg.content ?? '' };
    });
  }

  private mapTools(tools: Tool[]): OpenAI.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }));
  }

  private mapResponse(response: OpenAI.ChatCompletion, model: string): AIResponse {
    const choice = response.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice?.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        if ('function' in tc) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            args = { _raw: tc.function.arguments };
          }
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: args,
          });
        }
      }
    }

    const usage = response.usage;
    const tokenUsage: TokenUsage = {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      cachedTokens: 0,
      totalTokens: usage?.total_tokens ?? 0,
    };

    return {
      id: response.id,
      content: choice?.message.content ?? '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: tokenUsage,
      stopReason: this.mapStopReason(choice?.finish_reason),
      model,
      provider: 'openai',
    };
  }

  private mapChunkUsage(usage: OpenAI.CompletionUsage): TokenUsage {
    return {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      cachedTokens: 0,
      totalTokens: usage.total_tokens ?? 0,
    };
  }

  private mapStopReason(reason: string | null | undefined): AIResponse['stopReason'] {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      default:
        return 'end_turn';
    }
  }

  private mapError(error: unknown): Error {
    if (error instanceof OpenAI.APIError) {
      if (error.status === 429) {
        return new RateLimitError('openai', undefined, error);
      }
      if (error.status === 401) {
        return new AuthenticationError('openai', error);
      }
      if (error.status === 400 && error.message.includes('token')) {
        return new TokenLimitError('openai', error);
      }
      if (error.status === 502 || error.status === 503) {
        return new ProviderUnavailableError('openai', error.status, error);
      }
      return new InvalidResponseError('openai', error.message, error);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
