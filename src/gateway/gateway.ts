/**
 * Central GatewayRouter — routes all AI model calls through provider adapters.
 *
 * Handles provider selection per agent, automatic fallback on error,
 * rate limiting, and cost tracking.
 */

import type { ModelClient } from './model_client.js';
import type {
  GatewayConfig,
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  CompletionChunk,
} from '../types/provider_config.js';
import { AnthropicAdapter } from './anthropic_adapter.js';
import { OpenAIAdapter } from './openai_adapter.js';
import { GeminiAdapter } from './gemini_adapter.js';
import { RateLimiter } from './rate_limiter.js';
import { CostTracker, type TokenUsage } from './cost_tracker.js';

export class GatewayRouter {
  private providers: Map<string, ModelClient> = new Map();
  private defaultProvider: string;
  private fallbackProvider: string;
  private rateLimiter: RateLimiter;
  private costTracker: CostTracker;

  /** Per-agent provider overrides (agentId -> provider name). */
  private agentProviderMap: Map<string, string> = new Map();

  constructor(config: GatewayConfig) {
    this.defaultProvider = config.default_provider;
    this.fallbackProvider = config.fallback_provider;
    this.rateLimiter = new RateLimiter();
    this.costTracker = new CostTracker();

    for (const [name, providerConfig] of Object.entries(config.providers)) {
      const client = this.createAdapter(providerConfig);
      this.providers.set(name, client);
    }
  }

  /**
   * Assign a specific provider to an agent.
   */
  setAgentProvider(agentId: string, providerName: string): void {
    this.agentProviderMap.set(agentId, providerName);
  }

  /**
   * Set the per-minute token budget for an agent.
   */
  setAgentRateLimit(agentId: string, tokensPerMinute: number): void {
    this.rateLimiter.setBudget(agentId, tokensPerMinute);
  }

  /**
   * Route a completion request for the given agent to the appropriate provider.
   * Falls back to the fallback provider on error.
   */
  async complete(
    agentId: string,
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const client = this.getClientForAgent(agentId);

    // Check rate limit before proceeding.
    const estimatedTokens = this.estimateRequestTokens(request);
    const limitCheck = this.rateLimiter.checkLimit(agentId, estimatedTokens);
    if (!limitCheck.allowed) {
      throw new Error(
        `Rate limit exceeded for agent "${agentId}". ` +
          `Retry after ${limitCheck.retryAfterMs}ms.`
      );
    }

    try {
      const response = await client.complete(request);

      // Track usage.
      this.rateLimiter.recordUsage(agentId, response.usage.total_tokens);
      this.costTracker.recordUsage(agentId, client.provider, response.usage);

      return response;
    } catch (error) {
      return this.handleFallback(agentId, request, error);
    }
  }

  /**
   * Stream a completion request for the given agent.
   */
  async *stream(
    agentId: string,
    request: CompletionRequest
  ): AsyncIterable<CompletionChunk> {
    const client = this.getClientForAgent(agentId);

    const estimatedTokens = this.estimateRequestTokens(request);
    const limitCheck = this.rateLimiter.checkLimit(agentId, estimatedTokens);
    if (!limitCheck.allowed) {
      throw new Error(
        `Rate limit exceeded for agent "${agentId}". ` +
          `Retry after ${limitCheck.retryAfterMs}ms.`
      );
    }

    try {
      let totalDelta = '';
      for await (const chunk of client.stream(request)) {
        totalDelta += chunk.delta;
        yield chunk;
      }

      // Approximate usage from streamed output.
      const approxTokens = client.countTokens(totalDelta) + estimatedTokens;
      this.rateLimiter.recordUsage(agentId, approxTokens);
      this.costTracker.recordUsage(agentId, client.provider, {
        prompt_tokens: estimatedTokens,
        completion_tokens: client.countTokens(totalDelta),
        total_tokens: approxTokens,
      });
    } catch (error) {
      // For streaming, fallback yields a non-streamed completion as chunks.
      const fallbackResponse = await this.handleFallback(
        agentId,
        request,
        error
      );
      yield {
        id: fallbackResponse.id,
        delta: fallbackResponse.content,
        finish_reason: fallbackResponse.finish_reason,
      };
    }
  }

  /**
   * Get token usage stats for a specific agent.
   */
  getUsage(agentId: string): { tokens: number; cost: number } {
    const breakdown = this.costTracker.getCostBreakdown();
    return breakdown[agentId] ?? { tokens: 0, cost: 0 };
  }

  /**
   * Get the full cost breakdown for all agents.
   */
  getCostBreakdown(): Record<string, { tokens: number; cost: number }> {
    return this.costTracker.getCostBreakdown();
  }

  /**
   * Get total session cost.
   */
  getSessionCost(): number {
    return this.costTracker.getSessionCost();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getClientForAgent(agentId: string): ModelClient {
    const providerName =
      this.agentProviderMap.get(agentId) ?? this.defaultProvider;
    const client = this.providers.get(providerName);
    if (!client) {
      throw new Error(
        `No provider "${providerName}" registered for agent "${agentId}".`
      );
    }
    return client;
  }

  private async handleFallback(
    agentId: string,
    request: CompletionRequest,
    originalError: unknown
  ): Promise<CompletionResponse> {
    const fallback = this.providers.get(this.fallbackProvider);
    if (!fallback) {
      throw originalError;
    }

    // If the primary provider IS the fallback, don't retry with the same one.
    const primaryName =
      this.agentProviderMap.get(agentId) ?? this.defaultProvider;
    if (primaryName === this.fallbackProvider) {
      throw originalError;
    }

    console.warn(
      `[gateway] Primary provider "${primaryName}" failed for agent "${agentId}", ` +
        `falling back to "${this.fallbackProvider}". Error: ${originalError}`
    );

    const response = await fallback.complete(request);

    this.rateLimiter.recordUsage(agentId, response.usage.total_tokens);
    this.costTracker.recordUsage(agentId, fallback.provider, response.usage);

    return response;
  }

  private createAdapter(config: ProviderConfig): ModelClient {
    switch (config.type) {
      case 'anthropic':
        return new AnthropicAdapter(config);
      case 'openai':
        return new OpenAIAdapter(config);
      case 'gemini':
        return new GeminiAdapter(config);
      default:
        throw new Error(`Unsupported provider type: ${config.type}`);
    }
  }

  private estimateRequestTokens(request: CompletionRequest): number {
    let total = 0;
    if (request.system) {
      total += Math.ceil(request.system.length / 4);
    }
    for (const msg of request.messages) {
      total += Math.ceil(msg.content.length / 4);
    }
    return total;
  }
}
