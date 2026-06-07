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
  ThinkingBlock,
} from '@secureyeoman/shared';
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
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: { id: string; display_name?: string }[] };
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

  protected override resolveTemperature(request: AIRequest): number {
    // Anthropic requires temperature === 1 when extended thinking is enabled
    if (request.thinkingBudgetTokens) return 1;
    return request.temperature ?? this.modelConfig.temperature;
  }

  protected async doChat(request: AIRequest): Promise<AIResponse> {
    try {
      const { system, messages } = this.mapMessages(request.messages);
      const model = this.resolveModel(request);
      const cachedSystem = this.buildCachedSystem(system);

      const params: Anthropic.MessageCreateParams = {
        model,
        max_tokens: this.resolveMaxTokens(request),
        temperature: this.resolveTemperature(request),
        messages,
        ...(cachedSystem ? { system: cachedSystem } : {}),
        ...(request.tools?.length ? { tools: this.mapToolsCached(request.tools) } : {}),
        ...(request.stopSequences?.length ? { stop_sequences: request.stopSequences } : {}),
        ...(request.thinkingBudgetTokens
          ? { thinking: { type: 'enabled' as const, budget_tokens: request.thinkingBudgetTokens } }
          : {}),
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
    const cachedSystem = this.buildCachedSystem(system);

    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: this.resolveMaxTokens(request),
      temperature: this.resolveTemperature(request),
      messages,
      stream: true,
      ...(cachedSystem ? { system: cachedSystem } : {}),
      ...(request.tools?.length ? { tools: this.mapToolsCached(request.tools) } : {}),
      ...(request.stopSequences?.length ? { stop_sequences: request.stopSequences } : {}),
      ...(request.thinkingBudgetTokens
        ? { thinking: { type: 'enabled' as const, budget_tokens: request.thinkingBudgetTokens } }
        : {}),
    };

    try {
      const stream = this.client.messages.stream(params);

      let currentToolId = '';
      let currentToolName = '';
      let _currentToolArgs = '';
      let inThinkingBlock = false;

      try {
        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            const block = event.content_block as unknown as Record<string, unknown>;
            if (block.type === 'tool_use') {
              currentToolId = block.id as string;
              currentToolName = block.name as string;
              _currentToolArgs = '';
              inThinkingBlock = false;
            } else if (block.type === 'thinking') {
              inThinkingBlock = true;
            } else {
              inThinkingBlock = false;
            }
          } else if (event.type === 'content_block_delta') {
            const delta = event.delta as unknown as Record<string, unknown>;
            if (delta.type === 'thinking_delta') {
              yield { type: 'thinking_delta', thinking: (delta.thinking as string) ?? '' };
            } else if (delta.type === 'text_delta') {
              inThinkingBlock = false;
              yield { type: 'content_delta', content: (delta.text as string) ?? '' };
            } else if (delta.type === 'input_json_delta') {
              _currentToolArgs += (delta.partial_json as string) ?? '';
              yield {
                type: 'tool_call_delta',
                toolCall: { id: currentToolId, name: currentToolName },
              };
            }
          } else if (event.type === 'content_block_stop') {
            inThinkingBlock = false;
          } else if (event.type === 'message_delta') {
            const finalMessage = await stream.finalMessage();
            const usage = this.mapUsage(finalMessage.usage);

            // Extract complete tool calls and thinking blocks from the final message
            const doneToolCalls: ToolCall[] = [];
            const doneThinkingBlocks: ThinkingBlock[] = [];
            for (const rawFinalBlock of finalMessage.content) {
              const fb = rawFinalBlock as unknown as Record<string, unknown>;
              if (fb.type === 'tool_use') {
                doneToolCalls.push({
                  id: fb.id as string,
                  name: fb.name as string,
                  arguments: fb.input as Record<string, unknown>,
                });
              } else if (fb.type === 'thinking') {
                const thinking = fb.thinking as string;
                const signature = (fb.signature as string | undefined) ?? '';
                doneThinkingBlocks.push({ thinking, signature });
              }
            }

            yield {
              type: 'done',
              stopReason: this.mapStopReason(finalMessage.stop_reason),
              usage,
              ...(doneToolCalls.length > 0 ? { toolCalls: doneToolCalls } : {}),
              ...(doneThinkingBlocks.length > 0 ? { thinkingBlocks: doneThinkingBlocks } : {}),
            };
          }
        }
      } finally {
        // Cleanup: abort the Anthropic SDK stream if the consumer stopped iterating early
        if (typeof stream.abort === 'function') stream.abort();
      }
      void inThinkingBlock; // suppress unused warning
    } catch (error) {
      throw this.mapError(error);
    }
  }

  // ─── Mapping Helpers ─────────────────────────────────────────

  /**
   * Build a cache-enabled system parameter for Anthropic prompt caching.
   * Splits the system prompt into a cacheable block with cache_control: ephemeral,
   * so repeated calls with the same system prompt pay 90% less for cached input tokens.
   */
  private buildCachedSystem(
    system: string | undefined
  ): Anthropic.MessageCreateParams['system'] | undefined {
    if (!system) return undefined;
    return [
      {
        type: 'text' as const,
        text: system,
        cache_control: { type: 'ephemeral' as const },
      },
    ];
  }

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

      if (msg.role === 'assistant' && (msg.toolCalls?.length || msg.thinkingBlocks?.length)) {
        // Anthropic requires thinking blocks BEFORE text and tool_use blocks
        const content: Anthropic.ContentBlock[] = [
          ...(msg.thinkingBlocks ?? []).map(
            (tb) =>
              ({
                type: 'thinking',
                thinking: tb.thinking,
                signature: tb.signature,
              }) as unknown as Anthropic.ContentBlock
          ),
          ...(msg.content
            ? [{ type: 'text' as const, text: msg.content } as unknown as Anthropic.ContentBlock]
            : []),
          ...(msg.toolCalls ?? []).map(
            (tc) =>
              ({
                type: 'tool_use',
                id: tc.id,
                name: tc.name,
                input: tc.arguments,
              }) as unknown as Anthropic.ContentBlock
          ),
        ];
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

  /**
   * Map tools with cache_control on the last tool definition.
   * Anthropic caches everything up to and including the block marked ephemeral,
   * so marking the last tool caches the entire tool array + system prompt.
   */
  private mapToolsCached(tools: Tool[]): Anthropic.Tool[] {
    const mapped = this.mapTools(tools);
    if (mapped.length > 0) {
      const last = mapped[mapped.length - 1];
      mapped[mapped.length - 1] = {
        ...last,
        cache_control: { type: 'ephemeral' as const },
      } as Anthropic.Tool;
    }
    return mapped;
  }

  private mapResponse(response: Anthropic.Message, model: string): AIResponse {
    let content = '';
    let thinkingText = '';
    const toolCalls: ToolCall[] = [];
    const thinkingBlocks: ThinkingBlock[] = [];

    for (const rawBlock of response.content) {
      const block = rawBlock as unknown as Record<string, unknown>;
      if (block.type === 'text') {
        content += block.text as string;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id as string,
          name: block.name as string,
          arguments: block.input as Record<string, unknown>,
        });
      } else if (block.type === 'thinking') {
        const thinking = block.thinking as string;
        const signature = (block.signature as string | undefined) ?? '';
        thinkingText += thinking;
        thinkingBlocks.push({ thinking, signature });
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
      ...(thinkingText ? { thinkingContent: thinkingText } : {}),
      ...(thinkingBlocks.length > 0 ? { thinkingBlocks } : {}),
    };
  }

  private mapUsage(usage: Anthropic.Usage): TokenUsage {
    const usageRecord = usage as unknown as Record<string, unknown>;
    const cached = usageRecord.cache_read_input_tokens as number | undefined;
    const thinking = usageRecord.thinking_input_tokens as number | undefined;
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cachedTokens: cached ?? 0,
      totalTokens: usage.input_tokens + usage.output_tokens,
      thinkingTokens: thinking ?? 0,
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
