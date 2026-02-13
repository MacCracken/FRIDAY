/**
 * Google Gemini Provider
 *
 * Uses the @google/generative-ai package.
 * Maps functionDeclarations to unified Tool schema and
 * functionCall parts to unified ToolCall.
 */

import { GoogleGenerativeAI, type GenerativeModel, type Content, type Part, type FunctionDeclaration } from '@google/generative-ai';
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
  AuthenticationError,
  ProviderUnavailableError,
  InvalidResponseError,
} from '../errors.js';
import type { SecureLogger } from '../../logging/logger.js';

export interface GeminiModelInfo {
  id: string;
  displayName: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
}

export class GeminiProvider extends BaseProvider {
  readonly name: AIProviderName = 'gemini';
  private readonly genAI: GoogleGenerativeAI;

  constructor(config: ProviderConfig, logger?: SecureLogger) {
    super(config, logger);
    this.genAI = new GoogleGenerativeAI(this.apiKey ?? '');
  }

  /**
   * Fetch available models from Google's ListModels REST API.
   * Filters to models that support `generateContent` (the method FRIDAY uses).
   */
  static async fetchAvailableModels(apiKey: string): Promise<GeminiModelInfo[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Record<string, unknown>[] };
    return (data.models ?? [])
      .filter((m: Record<string, unknown>) =>
        (m.supportedGenerationMethods as string[] | undefined)?.includes('generateContent'),
      )
      .map((m: Record<string, unknown>) => ({
        id: (m.name as string).replace('models/', ''),
        displayName: m.displayName as string,
        inputTokenLimit: m.inputTokenLimit as number,
        outputTokenLimit: m.outputTokenLimit as number,
      }));
  }

  protected async doChat(request: AIRequest): Promise<AIResponse> {
    try {
      const model = this.getModel(request);
      const { system, contents } = this.mapMessages(request.messages);

      const result = await model.generateContent({
        contents,
        ...(system ? { systemInstruction: { role: 'user', parts: [{ text: system }] } } : {}),
      });

      const response = result.response;
      return this.mapResponse(response, this.resolveModel(request));
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async *chatStream(request: AIRequest): AsyncGenerator<AIStreamChunk, void, unknown> {
    try {
      const model = this.getModel(request);
      const { system, contents } = this.mapMessages(request.messages);

      const result = await model.generateContentStream({
        contents,
        ...(system ? { systemInstruction: { role: 'user', parts: [{ text: system }] } } : {}),
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          yield { type: 'content_delta', content: text };
        }

        // Check for function calls in streamed chunks
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if ('functionCall' in part && part.functionCall) {
              yield {
                type: 'tool_call_delta',
                toolCall: {
                  id: `gemini-${Date.now()}`,
                  name: part.functionCall.name,
                },
              };
            }
          }
        }
      }

      // Get final aggregated response for usage
      const aggregated = await result.response;
      const usage = this.mapUsage(aggregated);
      const stopReason = this.mapStopReason(aggregated);

      yield { type: 'done', stopReason, usage };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  // ─── Mapping Helpers ─────────────────────────────────────────

  private getModel(request: AIRequest): GenerativeModel {
    const modelName = this.resolveModel(request);
    const tools = request.tools?.length ? this.mapTools(request.tools) : undefined;

    return this.genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        maxOutputTokens: this.resolveMaxTokens(request),
        temperature: this.resolveTemperature(request),
        ...(request.stopSequences?.length ? { stopSequences: request.stopSequences } : {}),
      },
      ...(tools ? { tools: [{ functionDeclarations: tools }] } : {}),
    });
  }

  private mapMessages(messages: AIMessage[]): { system: string | undefined; contents: Content[] } {
    let system: string | undefined;
    const contents: Content[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
        continue;
      }

      if (msg.role === 'tool' && msg.toolResult) {
        contents.push({
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: msg.toolResult.toolCallId,
                response: { content: msg.toolResult.content },
              },
            },
          ],
        });
        continue;
      }

      if (msg.role === 'assistant') {
        const parts: Part[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.arguments as Record<string, unknown>,
              },
            });
          }
        }
        contents.push({ role: 'model', parts });
        continue;
      }

      // User messages
      contents.push({
        role: 'user',
        parts: [{ text: msg.content ?? '' }],
      });
    }

    return { system, contents };
  }

  private mapTools(tools: Tool[]): FunctionDeclaration[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      parameters: t.parameters as FunctionDeclaration['parameters'],
    }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapResponse(response: any, model: string): AIResponse {
    const candidates = response.candidates ?? [];
    const candidate = candidates[0];
    let content = '';
    const toolCalls: ToolCall[] = [];

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if ('text' in part) {
          content += part.text;
        }
        if ('functionCall' in part && part.functionCall) {
          toolCalls.push({
            id: `gemini-${Date.now()}-${toolCalls.length}`,
            name: part.functionCall.name,
            arguments: (part.functionCall.args as Record<string, unknown>) ?? {},
          });
        }
      }
    }

    return {
      id: `gemini-${Date.now()}`,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: this.mapUsage(response),
      stopReason: this.mapStopReason(response),
      model,
      provider: 'gemini',
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapUsage(response: any): TokenUsage {
    const meta = response.usageMetadata;
    return {
      inputTokens: meta?.promptTokenCount ?? 0,
      outputTokens: meta?.candidatesTokenCount ?? 0,
      cachedTokens: meta?.cachedContentTokenCount ?? 0,
      totalTokens: meta?.totalTokenCount ?? 0,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapStopReason(response: any): AIResponse['stopReason'] {
    const reason = response.candidates?.[0]?.finishReason;
    switch (reason) {
      case 'STOP':
        return 'end_turn';
      case 'MAX_TOKENS':
        return 'max_tokens';
      case 'SAFETY':
      case 'RECITATION':
        return 'error';
      default:
        return 'end_turn';
    }
  }

  private mapError(error: unknown): Error {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('429') || msg.includes('rate limit') || msg.includes('resource exhausted')) {
        return new RateLimitError('gemini', undefined, error);
      }
      if (msg.includes('401') || msg.includes('api key') || msg.includes('unauthorized')) {
        return new AuthenticationError('gemini', error);
      }
      if (msg.includes('503') || msg.includes('unavailable')) {
        return new ProviderUnavailableError('gemini', 503, error);
      }
      return new InvalidResponseError('gemini', error.message, error);
    }
    return new Error(String(error));
  }
}
