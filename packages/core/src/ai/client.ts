/**
 * AIClient — Main Orchestrator
 *
 * Factory method creates the correct provider from config.
 * Integrates with AuditChain for request/response logging (metadata only, never raw content).
 * Integrates with UsageTracker for token/cost aggregation.
 *
 * Supports a configurable fallback chain: when the primary provider returns a
 * rate-limit (429) or unavailability (502/503) error, the client automatically
 * tries alternative models in the order specified by `config.model.fallbacks`.
 * Fallback providers are instantiated lazily on first use.
 *
 * Note on streaming fallback: if a stream fails mid-delivery (after yielding
 * some chunks), the fallback starts a fresh stream. Callers may see partial
 * content from provider A followed by complete content from provider B.
 */

import type {
  AIRequest,
  AIResponse,
  AIStreamChunk,
  AIProviderName,
  ModelConfig,
  FallbackModelConfig,
} from '@secureyeoman/shared';
import { ResponseCache, type CacheStats } from './response-cache.js';
import type { AIProvider } from './providers/base.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { OpenAIWsProvider } from './providers/openai-ws.js';
import { GeminiProvider } from './providers/gemini.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenCodeProvider } from './providers/opencode.js';
import { LMStudioProvider } from './providers/lmstudio.js';
import { LocalAIProvider } from './providers/localai.js';
import { DeepSeekProvider } from './providers/deepseek.js';
import { MistralProvider } from './providers/mistral.js';
import { GrokProvider } from './providers/grok.js';
import { LettaProvider } from './providers/letta.js';
import { GroqProvider } from './providers/groq.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { AGNOSProvider } from './providers/agnos.js';
import { HooshProvider } from './providers/hoosh.js';
import { CostCalculator } from './cost-calculator.js';
import { UsageTracker, type UsageStats } from './usage-tracker.js';
import type { UsageStorage } from './usage-storage.js';
import { TokenLimitError, RateLimitError, ProviderUnavailableError } from './errors.js';
import type { AuditChain } from '../logging/audit-chain.js';
import type { SecureLogger } from '../logging/logger.js';
import { getSecret } from '../config/loader.js';
import type { RetryConfig } from './retry-manager.js';
import type { SoulManager } from '../soul/manager.js';
import type { ProviderHealthTracker } from './provider-health.js';
import type { TeeAttestationVerifier } from '../security/tee-attestation.js';
import type { CircuitBreakerRegistry } from '../resilience/circuit-breaker.js';
import { CircuitBreakerOpenError } from '../resilience/circuit-breaker.js';
import { getTracer } from '../telemetry/otel.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { toErrorMessage } from '../utils/errors.js';
import type { RoutingPolicy, PrivacyRoutingDecision } from './privacy-router.js';

export interface AIClientConfig {
  model: ModelConfig;
  retryConfig?: Partial<RetryConfig>;
}

export interface AIClientDeps {
  auditChain?: AuditChain;
  logger?: SecureLogger;
  usageStorage?: UsageStorage;
  soulManager?: SoulManager;
  /**
   * Pre-built tracker to reuse across model switches.
   * When provided, usageStorage is ignored for tracker construction —
   * the existing tracker (already seeded from DB) is carried over as-is.
   */
  usageTracker?: UsageTracker;
  /**
   * Pre-built response cache. When provided, overrides the cache constructed
   * from `config.model.responseCache` — useful for injecting a shared cache
   * across multiple clients or for testing.
   */
  responseCache?: ResponseCache;
  /**
   * Provider account manager for multi-account key resolution (Phase 112).
   * When provided, API keys are resolved through provider accounts instead
   * of directly from env vars.
   */
  providerAccountManager?: import('./provider-account-manager.js').ProviderAccountManager;
  /** Explicit provider account ID to use for key resolution. */
  accountId?: string;
  /** Provider health tracker for recording request outcomes (Phase 119). */
  healthTracker?: ProviderHealthTracker;
  /** TEE attestation verifier for confidential computing. */
  teeVerifier?: TeeAttestationVerifier;
  /** Circuit breaker registry for fail-fast on unhealthy providers. */
  circuitBreakerRegistry?: CircuitBreakerRegistry;
  /** DLP classification engine for privacy-aware routing. */
  classificationEngine?: import('../security/dlp/classification-engine.js').ClassificationEngine;
  /** Per-personality routing policy override. */
  routingPolicy?: RoutingPolicy;
}

const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio', 'localai']);

export class AIClient {
  private readonly provider: AIProvider;
  private readonly costCalculator: CostCalculator;
  private readonly usageTracker: UsageTracker;
  private readonly auditChain: AuditChain | null;
  private readonly logger: SecureLogger | null;
  private readonly providerName: AIProviderName;
  private readonly primaryModelConfig: ModelConfig;
  private readonly fallbackConfigs: FallbackModelConfig[];
  private readonly fallbackProviders = new Map<number, AIProvider>();
  private readonly retryConfig?: Partial<RetryConfig>;
  private readonly responseCache: ResponseCache | null;
  private soulManager: SoulManager | null;
  private readonly providerAccountManager:
    | import('./provider-account-manager.js').ProviderAccountManager
    | null;
  private readonly healthTracker: ProviderHealthTracker | null;
  private readonly teeVerifier: TeeAttestationVerifier | null;
  private readonly circuitBreakers: CircuitBreakerRegistry | null;
  private readonly classificationEngine:
    | import('../security/dlp/classification-engine.js').ClassificationEngine
    | null;
  private readonly routingPolicy: RoutingPolicy;
  private resolvedAccountId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private lastPrivacyDecision: PrivacyRoutingDecision | null = null;

  constructor(config: AIClientConfig, deps: AIClientDeps = {}) {
    this.costCalculator = new CostCalculator();
    this.usageTracker =
      deps.usageTracker ?? new UsageTracker(config.model.maxTokensPerDay, deps.usageStorage);
    this.auditChain = deps.auditChain ?? null;
    this.logger = deps.logger ?? null;
    this.providerName = config.model.provider;
    this.primaryModelConfig = config.model;
    this.fallbackConfigs = config.model.fallbacks ?? [];
    this.retryConfig = config.retryConfig;
    this.soulManager = deps.soulManager ?? null;
    this.providerAccountManager = deps.providerAccountManager ?? null;
    this.healthTracker = deps.healthTracker ?? null;
    this.teeVerifier = deps.teeVerifier ?? null;
    this.circuitBreakers = deps.circuitBreakerRegistry ?? null;
    this.classificationEngine = deps.classificationEngine ?? null;
    this.routingPolicy = deps.routingPolicy ?? 'auto';
    this.resolvedAccountId = deps.accountId ?? null;
    this.provider = this.createProvider(config);
    this.responseCache =
      deps.responseCache ??
      (config.model.responseCache.enabled ? new ResponseCache(config.model.responseCache) : null);
  }

  /** Inject or replace the SoulManager after construction. */
  setSoulManager(manager: SoulManager): void {
    this.soulManager = manager;
  }

  /** Get the last privacy routing decision (for UI display). */
  getLastPrivacyDecision(): PrivacyRoutingDecision | null {
    return this.lastPrivacyDecision;
  }

  /**
   * Evaluate privacy-aware routing for a request.
   * When the classification engine is available and routing policy is not cloud-only,
   * this checks content sensitivity and GPU availability to decide local vs cloud.
   * Returns null when privacy routing is not configured.
   */
  private async evaluatePrivacyRouting(content: string): Promise<PrivacyRoutingDecision | null> {
    // Skip when no classification engine or policy is cloud-only
    if (!this.classificationEngine || this.routingPolicy === 'cloud-only') {
      return null;
    }

    // Skip when primary is already a local provider or a gateway that handles routing internally
    if (LOCAL_PROVIDERS.has(this.providerName) || this.providerName === 'hoosh') {
      return null;
    }

    try {
      const { probeGpu } = await import('./gpu-probe.js');
      const { refreshLocalModels } = await import('./local-model-registry.js');
      const { routeWithPrivacy } = await import('./privacy-router.js');

      const classification = this.classificationEngine.classify(content);
      const [gpu, localModels] = await Promise.all([probeGpu(), refreshLocalModels()]);

      const decision = routeWithPrivacy(
        classification.level,
        classification.piiFound,
        gpu,
        localModels,
        [],
        { policy: this.routingPolicy }
      );

      this.lastPrivacyDecision = decision;

      if (decision.target === 'local' && decision.localModel) {
        void this.auditRecord('ai_privacy_route_local', {
          reason: decision.reason,
          classification: decision.classificationLevel,
          containsPii: decision.containsPii,
          localModel: decision.localModel.name,
          localProvider: decision.localModel.provider,
          confidence: decision.confidence,
        });
      }

      return decision;
    } catch (error) {
      this.logger?.warn(
        { error: toErrorMessage(error) },
        'Privacy routing evaluation failed, falling back to default'
      );
      return null;
    }
  }

  /**
   * Returns fallback indices that are local providers, used for localFirst pre-attempts.
   * Returns an empty array when localFirst is false or primary is already local.
   */
  private getLocalFirstPreAttemptIndices(): number[] {
    if (!this.primaryModelConfig.localFirst) return [];
    // Hoosh handles local-first routing internally — no SY-side pre-attempts needed
    if (
      LOCAL_PROVIDERS.has(this.primaryModelConfig.provider) ||
      this.primaryModelConfig.provider === 'hoosh'
    )
      return [];
    return this.fallbackConfigs
      .map((fb, i) => (LOCAL_PROVIDERS.has(fb.provider) ? i : -1))
      .filter((i) => i >= 0);
  }

  /**
   * Non-streaming chat completion with fallback support.
   *
   * @param requestFallbacks - Optional per-request fallback chain. When provided, overrides
   *   the system-level `config.model.fallbacks` for this call only.
   */
  async chat(
    request: AIRequest,
    context?: Record<string, unknown>,
    requestFallbacks?: FallbackModelConfig[]
  ): Promise<AIResponse> {
    await this.ensureInitialized();
    // Check daily limit
    const limit = this.usageTracker.checkLimit();
    if (!limit.allowed) {
      throw new TokenLimitError(this.providerName);
    }

    // Cache check — only for non-streaming requests
    const cache = this.responseCache;
    const cacheKey = cache?.buildKey(
      this.providerName,
      request.model ?? this.primaryModelConfig.model,
      request
    );
    if (cache && cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        await this.auditRecord('ai_cache_hit', {
          provider: this.providerName,
          model: cached.model,
          keyPrefix: cacheKey.slice(0, 8),
        });
        return cached;
      }
    }

    const fallbacks = requestFallbacks ?? this.fallbackConfigs;

    // Privacy-aware routing: check if content should be routed to a local model
    const messageContent = request.messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join(' ');
    const privacyDecision =
      messageContent.length > 0 ? await this.evaluatePrivacyRouting(messageContent) : null;

    // Warn when sensitive content must go to cloud (no local GPU available)
    if (
      privacyDecision?.target === 'cloud' &&
      privacyDecision.containsPii &&
      privacyDecision.reason === 'local-insufficient'
    ) {
      this.logger?.warn(
        {
          classification: privacyDecision.classificationLevel,
          containsPii: true,
          reason: privacyDecision.reason,
          confidence: privacyDecision.confidence,
        },
        'Sensitive content routed to cloud — no local GPU/model available for privacy-enforced routing'
      );
      void this.auditRecord('ai_privacy_cloud_fallback_sensitive', {
        classification: privacyDecision.classificationLevel,
        containsPii: true,
        reason: privacyDecision.reason,
      });
    }

    if (privacyDecision?.target === 'local' && privacyDecision.localModel) {
      const localModel = privacyDecision.localModel;
      try {
        const localProvider = this.createProvider({
          model: {
            ...this.primaryModelConfig,
            provider: localModel.provider,
            model: localModel.name,
          },
        });
        const response = await this.doChatWithProvider(
          localProvider,
          localModel.provider,
          { ...request, model: localModel.name },
          { ...context, privacyRouted: true, routingReason: privacyDecision.reason }
        );
        return response;
      } catch (error) {
        this.logger?.warn(
          { error: toErrorMessage(error), model: localModel.name },
          'Privacy-routed local inference failed, falling back to default provider'
        );
        void this.auditRecord('ai_privacy_route_fallback', {
          reason: privacyDecision.reason,
          localModel: localModel.name,
          error: toErrorMessage(error),
        });
      }
    }

    // Local-first pre-attempts: try local fallbacks before cloud primary
    const preAttemptIndices = this.getLocalFirstPreAttemptIndices();
    const triedIndices = new Set<number>();
    for (const idx of preAttemptIndices) {
      const fbConfig = fallbacks[idx];
      if (!fbConfig) continue;
      triedIndices.add(idx);
      try {
        const fbProvider = this.getOrCreateFallbackProvider(idx, fbConfig);
        const response = await this.doChatWithProvider(
          fbProvider,
          fbConfig.provider,
          request,
          context
        );
        await this.auditRecord('ai_local_first_success', {
          index: idx,
          provider: fbConfig.provider,
          model: fbConfig.model,
        });
        return response;
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
        // local unavailable — continue to next pre-attempt or primary
      }
    }

    // Try primary provider
    let primaryError: Error | undefined;
    try {
      const response = await this.doChatWithProvider(
        this.provider,
        this.providerName,
        request,
        context
      );
      // Cache successful primary responses only (not fallback responses)
      if (cache && cacheKey) {
        cache.set(cacheKey, response);
      }
      return response;
    } catch (error) {
      primaryError = error as Error;
      if (!this.isFallbackEligible(primaryError) || fallbacks.length === 0) {
        throw primaryError;
      }
    }

    // Primary failed with a fallback-eligible error — try fallbacks
    await this.auditRecord('ai_fallback_triggered', {
      primaryProvider: this.providerName,
      error: primaryError.message,
      fallbackCount: fallbacks.length,
    });

    for (let i = 0; i < fallbacks.length; i++) {
      if (triedIndices.has(i)) continue; // skip already-tried local pre-attempts
      const fbConfig = fallbacks[i]!;
      const fbProviderName = fbConfig.provider;

      await this.auditRecord('ai_fallback_attempt', {
        index: i,
        provider: fbProviderName,
        model: fbConfig.model,
      });

      try {
        const fbProvider = this.getOrCreateFallbackProvider(i, fbConfig);
        const response = await this.doChatWithProvider(
          fbProvider,
          fbProviderName,
          request,
          context
        );

        await this.auditRecord('ai_fallback_success', {
          index: i,
          provider: fbProviderName,
          model: fbConfig.model,
        });

        return response;
      } catch (error) {
        const fbError = error as Error;
        if (!this.isFallbackEligible(fbError)) {
          // Non-recoverable error from fallback — don't continue chain
          throw fbError;
        }
        // Fallback-eligible error — continue to next fallback
      }
    }

    // All fallbacks exhausted
    await this.auditRecord('ai_fallback_exhausted', {
      primaryProvider: this.providerName,
      fallbackCount: fallbacks.length,
    });

    throw primaryError;
  }

  /**
   * Streaming chat completion (async generator) with fallback support.
   *
   * @param requestFallbacks - Optional per-request fallback chain. When provided, overrides
   *   the system-level `config.model.fallbacks` for this call only.
   */
  async *chatStream(
    request: AIRequest,
    context?: Record<string, unknown>,
    requestFallbacks?: FallbackModelConfig[]
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    await this.ensureInitialized();
    const limit = this.usageTracker.checkLimit();
    if (!limit.allowed) {
      throw new TokenLimitError(this.providerName);
    }

    const fallbacks = requestFallbacks ?? this.fallbackConfigs;

    // Local-first pre-attempts: try local fallbacks before cloud primary
    const preAttemptIndices = this.getLocalFirstPreAttemptIndices();
    const triedIndices = new Set<number>();
    for (const idx of preAttemptIndices) {
      const fbConfig = fallbacks[idx];
      if (!fbConfig) continue;
      triedIndices.add(idx);
      try {
        const fbProvider = this.getOrCreateFallbackProvider(idx, fbConfig);
        yield* this.doChatStreamWithProvider(fbProvider, fbConfig.provider, request, context);
        await this.auditRecord('ai_local_first_success', {
          index: idx,
          provider: fbConfig.provider,
          model: fbConfig.model,
          stream: true,
        });
        return;
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
        // local unavailable — continue
      }
    }

    // Try primary provider
    let primaryError: Error | undefined;
    try {
      yield* this.doChatStreamWithProvider(this.provider, this.providerName, request, context);
      return;
    } catch (error) {
      primaryError = error as Error;
      if (!this.isFallbackEligible(primaryError) || fallbacks.length === 0) {
        throw primaryError;
      }
    }

    // Primary failed — try fallbacks
    await this.auditRecord('ai_fallback_triggered', {
      primaryProvider: this.providerName,
      error: primaryError.message,
      fallbackCount: fallbacks.length,
      stream: true,
    });

    for (let i = 0; i < fallbacks.length; i++) {
      if (triedIndices.has(i)) continue; // skip already-tried local pre-attempts
      const fbConfig = fallbacks[i]!;
      const fbProviderName = fbConfig.provider;

      await this.auditRecord('ai_fallback_attempt', {
        index: i,
        provider: fbProviderName,
        model: fbConfig.model,
        stream: true,
      });

      try {
        const fbProvider = this.getOrCreateFallbackProvider(i, fbConfig);
        yield* this.doChatStreamWithProvider(fbProvider, fbProviderName, request, context);

        await this.auditRecord('ai_fallback_success', {
          index: i,
          provider: fbProviderName,
          model: fbConfig.model,
          stream: true,
        });

        return;
      } catch (error) {
        const fbError = error as Error;
        if (!this.isFallbackEligible(fbError)) {
          throw fbError;
        }
      }
    }

    // All fallbacks exhausted
    await this.auditRecord('ai_fallback_exhausted', {
      primaryProvider: this.providerName,
      fallbackCount: fallbacks.length,
      stream: true,
    });

    throw primaryError;
  }

  /**
   * Get aggregated usage statistics.
   */
  getUsageStats(): UsageStats {
    return this.usageTracker.getStats();
  }

  /**
   * Get the usage tracker instance (for cost optimizer integration).
   */
  getUsageTracker(): UsageTracker {
    return this.usageTracker;
  }

  getCostCalculator(): CostCalculator {
    return this.costCalculator;
  }

  getHealthTracker(): ProviderHealthTracker | null {
    return this.healthTracker;
  }

  /**
   * Get response cache hit/miss statistics.
   * Returns null when the cache is not enabled for this client.
   */
  getCacheStats(): CacheStats | null {
    return this.responseCache?.getStats() ?? null;
  }

  /**
   * Load historical usage records from the database.
   * Safe to call multiple times — subsequent calls are no-ops.
   * Called automatically on the first chat()/chatStream() invocation;
   * you may also call it explicitly during startup if eager seeding is preferred.
   */
  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.usageTracker.init();
    }
    await this.initPromise;
  }

  /** Ensure usage history is loaded before processing a request. */
  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.usageTracker.init();
    }
    await this.initPromise;
  }

  /**
   * Get the underlying provider name.
   */
  getProviderName(): AIProviderName {
    return this.providerName;
  }

  // ─── Private Helpers ─────────────────────────────────────────

  /**
   * Returns true for errors that should trigger fallback (rate limit, provider unavailable).
   */
  private isFallbackEligible(error: Error): boolean {
    return (
      error instanceof RateLimitError ||
      error instanceof ProviderUnavailableError ||
      error instanceof CircuitBreakerOpenError
    );
  }

  /**
   * Lazily instantiate a fallback provider, caching it for reuse.
   * When called with an explicit fbConfig (per-request fallbacks), uses a separate cache key
   * that won't collide with the system-level fallback providers.
   * Inherits retry config and unset fields from the primary model config.
   */
  private getOrCreateFallbackProvider(index: number, fbConfig: FallbackModelConfig): AIProvider {
    // Use a negative index offset to distinguish per-request fallbacks from system-level ones
    const cacheKey = index;
    const cached = this.fallbackProviders.get(cacheKey);
    // Only reuse cached provider if it matches the same provider+model
    if (cached) {
      const systemFbConfig = this.fallbackConfigs[index];
      if (
        systemFbConfig?.provider === fbConfig.provider &&
        systemFbConfig.model === fbConfig.model
      ) {
        return cached;
      }
    }

    // Build a full ModelConfig by inheriting unset fields from primary
    const fullModelConfig: ModelConfig = {
      provider: fbConfig.provider,
      model: fbConfig.model,
      apiKeyEnv: fbConfig.apiKeyEnv,
      baseUrl: fbConfig.baseUrl ?? this.primaryModelConfig.baseUrl,
      maxTokens: fbConfig.maxTokens ?? this.primaryModelConfig.maxTokens,
      temperature: fbConfig.temperature ?? this.primaryModelConfig.temperature,
      maxRequestsPerMinute: this.primaryModelConfig.maxRequestsPerMinute,
      maxTokensPerDay: this.primaryModelConfig.maxTokensPerDay,
      requestTimeoutMs: fbConfig.requestTimeoutMs ?? this.primaryModelConfig.requestTimeoutMs,
      maxRetries: this.primaryModelConfig.maxRetries,
      retryDelayMs: this.primaryModelConfig.retryDelayMs,
      fallbacks: [],
      responseCache: this.primaryModelConfig.responseCache,
      localFirst: this.primaryModelConfig.localFirst,
      confidentialCompute:
        fbConfig.confidentialCompute ?? this.primaryModelConfig.confidentialCompute,
      useWebSocket: this.primaryModelConfig.useWebSocket,
    };

    const provider = this.createProvider({ model: fullModelConfig, retryConfig: this.retryConfig });
    // Only cache system-level fallbacks (when they match the configured index)
    if (
      this.fallbackConfigs[index]?.provider === fbConfig.provider &&
      this.fallbackConfigs[index]?.model === fbConfig.model
    ) {
      this.fallbackProviders.set(cacheKey, provider);
    }
    return provider;
  }

  /**
   * Execute a non-streaming chat call against a specific provider, with audit, usage tracking, and OTel span.
   */
  private async doChatWithProvider(
    provider: AIProvider,
    providerName: AIProviderName,
    request: AIRequest,
    context?: Record<string, unknown>
  ): Promise<AIResponse> {
    await this.verifyTeeCompliance(providerName);
    const tracer = getTracer('secureyeoman.ai');
    const model = request.model ?? 'default';

    return tracer.startActiveSpan(`ai.chat ${providerName}/${model}`, async (span) => {
      span.setAttribute('ai.provider', providerName);
      span.setAttribute('ai.model', model);
      span.setAttribute('ai.stream', false);
      span.setAttribute('ai.message_count', request.messages.length);
      if (request.tools?.length) span.setAttribute('ai.tool_count', request.tools.length);

      const startTime = Date.now();

      await this.auditRecord('ai_request', {
        provider: providerName,
        model,
        messageCount: request.messages.length,
        hasTools: !!request.tools?.length,
        stream: false,
        ...(context ?? {}),
      });

      // Circuit breaker: fail fast if provider is known-unhealthy
      const breaker = this.circuitBreakers?.get(`ai:${providerName}`);
      try {
        const chatFn = () => provider.chat(request);
        const response = breaker ? await breaker.execute(chatFn) : await chatFn();
        const elapsed = Date.now() - startTime;

        span.setAttribute('ai.latency_ms', elapsed);
        span.setAttribute('ai.input_tokens', response.usage.inputTokens);
        span.setAttribute('ai.output_tokens', response.usage.outputTokens);
        span.setAttribute('ai.total_tokens', response.usage.totalTokens);
        span.setAttribute('ai.stop_reason', response.stopReason ?? 'unknown');
        span.setStatus({ code: SpanStatusCode.OK });

        this.healthTracker?.recordRequest(providerName, true, elapsed);
        await this.trackUsage(response, elapsed);

        await this.auditRecord('ai_response', {
          provider: response.provider,
          model: response.model,
          stopReason: response.stopReason,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cachedTokens: response.usage.cachedTokens,
          latencyMs: elapsed,
        });

        span.end();
        return response;
      } catch (error) {
        const elapsed = Date.now() - startTime;
        span.setAttribute('ai.latency_ms', elapsed);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown',
        });
        span.recordException(error instanceof Error ? error : new Error(String(error)));

        // Don't record health tracker failure for circuit breaker rejections
        if (!(error instanceof CircuitBreakerOpenError)) {
          this.healthTracker?.recordRequest(providerName, false, elapsed);
        }
        this.usageTracker.recordError(providerName, model);
        this.usageTracker.recordLatency(elapsed);

        await this.auditRecord('ai_error', {
          provider: providerName,
          error: toErrorMessage(error),
          latencyMs: elapsed,
        });

        span.end();
        throw error;
      }
    });
  }

  /**
   * Execute a streaming chat call against a specific provider, with audit, usage tracking, and OTel span.
   */
  private async *doChatStreamWithProvider(
    provider: AIProvider,
    providerName: AIProviderName,
    request: AIRequest,
    context?: Record<string, unknown>
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    await this.verifyTeeCompliance(providerName);
    const tracer = getTracer('secureyeoman.ai');
    const model = request.model ?? 'default';
    const span = tracer.startSpan(`ai.chat.stream ${providerName}/${model}`, {
      attributes: {
        'ai.provider': providerName,
        'ai.model': model,
        'ai.stream': true,
        'ai.message_count': request.messages.length,
      },
    });
    if (request.tools?.length) span.setAttribute('ai.tool_count', request.tools.length);

    const startTime = Date.now();

    await this.auditRecord('ai_stream_request', {
      provider: providerName,
      model,
      messageCount: request.messages.length,
      hasTools: !!request.tools?.length,
      stream: true,
      ...(context ?? {}),
    });

    // Circuit breaker: fail fast if provider is known-unhealthy
    const breaker = this.circuitBreakers?.get(`ai:${providerName}`);
    if (breaker) {
      const st = breaker.getState();
      if (st === 'open') throw new CircuitBreakerOpenError(breaker.name);
    }

    try {
      for await (const chunk of provider.chatStream(request)) {
        yield chunk;

        // Track usage from the final 'done' or 'usage' chunks
        if (chunk.type === 'done' && chunk.usage) {
          const elapsed = Date.now() - startTime;
          span.setAttribute('ai.latency_ms', elapsed);
          span.setAttribute('ai.input_tokens', chunk.usage.inputTokens);
          span.setAttribute('ai.output_tokens', chunk.usage.outputTokens);
          span.setAttribute('ai.total_tokens', chunk.usage.totalTokens);
          span.setStatus({ code: SpanStatusCode.OK });

          const costUsd = this.costCalculator.calculate(
            providerName,
            request.model ?? provider.name,
            chunk.usage
          );

          const streamPersonality = this.soulManager
            ? await this.soulManager.getActivePersonality().catch(() => null)
            : null;

          this.usageTracker.record({
            provider: providerName,
            model,
            usage: chunk.usage,
            costUsd,
            timestamp: Date.now(),
            personalityId: streamPersonality?.id,
            latencyMs: elapsed,
          });

          await this.auditRecord('ai_stream_done', {
            provider: providerName,
            stopReason: chunk.stopReason,
            inputTokens: chunk.usage.inputTokens,
            outputTokens: chunk.usage.outputTokens,
            latencyMs: elapsed,
          });
        }
      }
      breaker?.recordSuccess();
      span.end();
    } catch (error) {
      const elapsed = Date.now() - startTime;
      span.setAttribute('ai.latency_ms', elapsed);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown',
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.end();

      if (!(error instanceof CircuitBreakerOpenError)) {
        breaker?.recordFailure();
      }
      this.usageTracker.recordError(providerName, model);

      await this.auditRecord('ai_stream_error', {
        provider: providerName,
        error: toErrorMessage(error),
        latencyMs: elapsed,
      });

      throw error;
    }
  }

  /**
   * Verify that the provider meets TEE/confidential compute requirements.
   * Checks model-level override first, then falls back to security-level config.
   * Only active when a teeVerifier is injected.
   */
  private async verifyTeeCompliance(providerName: string): Promise<void> {
    if (!this.teeVerifier) return;

    // Model-level confidentialCompute overrides security-level tee config
    const modelLevel = this.primaryModelConfig.confidentialCompute;
    if (modelLevel === 'off') return;

    const { allowed, result } = await this.teeVerifier.verifyAsync(providerName);
    if (!allowed) {
      throw new ProviderUnavailableError(
        `Provider '${providerName}' does not meet TEE/confidential compute requirements` +
          (result.details ? `: ${result.details}` : '')
      );
    }
  }

  private createProvider(config: AIClientConfig): AIProvider {
    const noKeyProviders = ['ollama', 'lmstudio', 'localai', 'hoosh'];
    // Provider account key resolution happens lazily via ensureInitialized().
    // At construction time, fall back to env var for immediate use.
    const apiKey = !noKeyProviders.includes(config.model.provider)
      ? getSecret(config.model.apiKeyEnv)
      : undefined;

    const providerConfig = {
      model: config.model,
      apiKey,
      retryConfig: config.retryConfig,
    };

    switch (config.model.provider) {
      case 'anthropic':
        return new AnthropicProvider(providerConfig, this.logger ?? undefined);
      case 'openai':
        return config.model.useWebSocket
          ? new OpenAIWsProvider(providerConfig, this.logger ?? undefined)
          : new OpenAIProvider(providerConfig, this.logger ?? undefined);
      case 'gemini':
        return new GeminiProvider(providerConfig, this.logger ?? undefined);
      case 'ollama':
        return new OllamaProvider(providerConfig, this.logger ?? undefined);
      case 'opencode':
        return new OpenCodeProvider(providerConfig, this.logger ?? undefined);
      case 'lmstudio':
        return new LMStudioProvider(providerConfig, this.logger ?? undefined);
      case 'localai':
        return new LocalAIProvider(providerConfig, this.logger ?? undefined);
      case 'deepseek':
        return new DeepSeekProvider(providerConfig, this.logger ?? undefined);
      case 'mistral':
        return new MistralProvider(providerConfig, this.logger ?? undefined);
      case 'grok':
        return new GrokProvider(providerConfig, this.logger ?? undefined);
      case 'letta':
        return new LettaProvider(providerConfig, this.logger ?? undefined);
      case 'groq':
        return new GroqProvider(providerConfig, this.logger ?? undefined);
      case 'openrouter':
        return new OpenRouterProvider(providerConfig, this.logger ?? undefined);
      case 'agnos':
        return new AGNOSProvider(providerConfig, this.logger ?? undefined);
      case 'hoosh':
        return new HooshProvider(providerConfig, this.logger ?? undefined);
      default:
        throw new Error(`Unknown AI provider: ${config.model.provider}`);
    }
  }

  private async trackUsage(response: AIResponse, elapsed: number): Promise<void> {
    const costUsd = this.costCalculator.calculate(
      this.providerName,
      response.model,
      response.usage
    );

    const personality = this.soulManager
      ? await this.soulManager.getActivePersonality().catch(() => null)
      : null;

    this.usageTracker.record({
      provider: this.providerName,
      model: response.model,
      usage: response.usage,
      costUsd,
      timestamp: Date.now(),
      personalityId: personality?.id,
      latencyMs: elapsed,
    });

    // Fire-and-forget per-account cost recording (Phase 112)
    if (this.providerAccountManager && this.resolvedAccountId) {
      this.providerAccountManager
        .recordCost({
          accountId: this.resolvedAccountId,
          personalityId: personality?.id,
          model: response.model,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          totalTokens: response.usage.totalTokens,
          costUsd,
          requestId: response.id,
        })
        .catch((e: unknown) => {
          this.logger?.debug({ error: String(e) }, 'Provider account cost recording failed');
        });
    }
  }

  private async auditRecord(event: string, metadata: Record<string, unknown>): Promise<void> {
    if (!this.auditChain) return;

    try {
      await this.auditChain.record({
        event,
        level: event.includes('error') || event.includes('exhausted') ? 'warn' : 'info',
        message: `AI ${event}`,
        metadata,
      });
    } catch {
      // Audit logging should never block AI operations
      this.logger?.warn({ event }, 'Failed to record AI audit event');
    }
  }
}
