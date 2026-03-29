/**
 * Local model adapter — shared adapter for Ollama and LM Studio.
 *
 * Ollama exposes two API styles:
 *   - Native: /api/chat (always available)
 *   - OpenAI-compatible: /v1/chat/completions (available in newer versions)
 *
 * LM Studio always uses: /v1/chat/completions
 *
 * This adapter auto-detects the correct endpoint and handles connection
 * errors with clear diagnostics.
 */

import type { ModelClient } from './model_client.js';
import type {
  CompletionRequest,
  CompletionResponse,
  CompletionChunk,
  ProviderConfig,
} from '../types/provider_config.js';

const DEFAULT_TIMEOUT_MS = 30000;
const CONNECT_TIMEOUT_MS = 5000;

export class LocalModelAdapter implements ModelClient {
  readonly provider: string;
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;
  private useNativeOllamaApi: boolean = false;
  private endpointVerified: boolean = false;

  constructor(config: ProviderConfig) {
    this.provider = config.type; // 'ollama' or 'lmstudio'
    this.model = config.model;
    this.baseUrl = (config.base_url ?? this.defaultUrl()).replace(/\/+$/, '');
    this.timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  }

  private defaultUrl(): string {
    return this.provider === 'lmstudio'
      ? 'http://localhost:1234/v1'
      : 'http://localhost:11434';
  }

  /**
   * Test if the local model endpoint is reachable.
   * Returns { ok, message } with diagnostics.
   */
  async testConnection(): Promise<{ ok: boolean; message: string; models?: string[] }> {
    // Step 1: Basic connectivity
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

      let healthUrl: string;
      if (this.provider === 'ollama') {
        healthUrl = `${this.baseUrl}/api/tags`;
      } else {
        healthUrl = `${this.baseUrl}/models`;
      }

      const res = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        // Ollama might not have /api/tags, try root
        if (this.provider === 'ollama') {
          const rootRes = await fetch(this.baseUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
          });
          if (rootRes.ok) {
            return { ok: true, message: `Connected to Ollama at ${this.baseUrl}` };
          }
        }
        return { ok: false, message: `${this.provider} responded with HTTP ${res.status} at ${healthUrl}` };
      }

      // Try to list models
      const data: any = await res.json();
      const models: string[] = [];

      if (this.provider === 'ollama' && data.models) {
        for (const m of data.models) {
          models.push(m.name || m.model);
        }
      } else if (data.data) {
        for (const m of data.data) {
          models.push(m.id);
        }
      }

      return {
        ok: true,
        message: `Connected to ${this.provider} at ${this.baseUrl}`,
        models: models.length > 0 ? models : undefined,
      };
    } catch (err: any) {
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        return {
          ok: false,
          message: `Connection timed out after ${CONNECT_TIMEOUT_MS}ms. Is ${this.provider} running at ${this.baseUrl}?`,
        };
      }
      if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        return {
          ok: false,
          message: `Connection refused at ${this.baseUrl}. Make sure ${this.provider} is running:\n` +
            (this.provider === 'ollama'
              ? `    $ ollama serve\n    $ ollama run ${this.model}`
              : `    Open LM Studio → Start Server`),
        };
      }
      if (err.cause?.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
        return {
          ok: false,
          message: `Host not found: ${this.baseUrl}. Check the URL is correct.`,
        };
      }
      return {
        ok: false,
        message: `Connection failed: ${err.message || err}`,
      };
    }
  }

  /**
   * Detect whether to use Ollama native API or OpenAI-compatible API.
   */
  private async detectEndpoint(): Promise<void> {
    if (this.endpointVerified) return;

    if (this.provider === 'lmstudio') {
      this.useNativeOllamaApi = false;
      this.endpointVerified = true;
      return;
    }

    // For Ollama, try OpenAI-compatible first, fall back to native
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });

      if (res.ok || res.status === 400) {
        // 400 means the endpoint exists but maybe model isn't loaded
        this.useNativeOllamaApi = false;
        this.endpointVerified = true;
        return;
      }
    } catch {
      // OpenAI-compat endpoint not available
    }

    // Fall back to native Ollama API
    this.useNativeOllamaApi = true;
    this.endpointVerified = true;
  }

  private getCompletionUrl(): string {
    if (this.useNativeOllamaApi) {
      return `${this.baseUrl}/api/chat`;
    }
    // LM Studio base_url usually already ends with /v1
    if (this.provider === 'lmstudio') {
      const url = this.baseUrl.endsWith('/v1') ? this.baseUrl : `${this.baseUrl}/v1`;
      return `${url}/chat/completions`;
    }
    return `${this.baseUrl}/v1/chat/completions`;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    await this.detectEndpoint();

    const model = request.model ?? this.model;
    const messages = this.buildMessages(request);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = this.getCompletionUrl();
      const body = this.useNativeOllamaApi
        ? JSON.stringify({ model, messages, stream: false })
        : JSON.stringify({
            model,
            messages,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: false,
          });

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(
          `${this.provider} API error (${res.status}): ${errBody}`
        );
      }

      const data: any = await res.json();

      // Ollama native API returns differently
      if (this.useNativeOllamaApi) {
        return {
          id: `ollama-${Date.now()}`,
          content: data.message?.content ?? '',
          model: data.model ?? model,
          usage: {
            prompt_tokens: data.prompt_eval_count ?? 0,
            completion_tokens: data.eval_count ?? 0,
            total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
          },
          finish_reason: data.done ? 'stop' : 'length',
        };
      }

      // OpenAI-compatible response
      const choice = data.choices?.[0];
      return {
        id: data.id ?? `local-${Date.now()}`,
        content: choice?.message?.content ?? '',
        model: data.model ?? model,
        usage: {
          prompt_tokens: data.usage?.prompt_tokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? 0,
          total_tokens: data.usage?.total_tokens ?? 0,
        },
        finish_reason: choice?.finish_reason ?? 'stop',
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(
          `${this.provider} request timed out after ${this.timeoutMs}ms. ` +
          `The model may be loading — try again in a moment.`
        );
      }
      if (err.cause?.code === 'ECONNREFUSED') {
        throw new Error(
          `Cannot connect to ${this.provider} at ${this.baseUrl}. ` +
          `Make sure it's running.`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    await this.detectEndpoint();

    const model = request.model ?? this.model;
    const messages = this.buildMessages(request);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = this.getCompletionUrl();
      const body = this.useNativeOllamaApi
        ? JSON.stringify({ model, messages, stream: true })
        : JSON.stringify({
            model,
            messages,
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            stream: true,
          });

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(
          `${this.provider} API error (${res.status}): ${errBody}`
        );
      }

      if (!res.body) {
        throw new Error('Response body is null — streaming not supported');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Ollama native API streams JSON objects per line (no "data:" prefix)
          if (this.useNativeOllamaApi) {
            try {
              const data = JSON.parse(trimmed);
              if (data.done) return;
              yield {
                id: `ollama-${Date.now()}`,
                delta: data.message?.content ?? '',
              };
            } catch { /* skip malformed */ }
            continue;
          }

          // OpenAI-compatible SSE format
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') return;

          try {
            const data = JSON.parse(payload);
            const choice = data.choices?.[0];
            if (!choice) continue;

            yield {
              id: data.id ?? `local-${Date.now()}`,
              delta: choice.delta?.content ?? '',
              ...(choice.finish_reason
                ? { finish_reason: choice.finish_reason }
                : {}),
            };
          } catch {
            // Skip malformed JSON lines.
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(
          `${this.provider} stream timed out after ${this.timeoutMs}ms.`
        );
      }
      if (err.cause?.code === 'ECONNREFUSED') {
        throw new Error(
          `Cannot connect to ${this.provider} at ${this.baseUrl}. Make sure it's running.`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private buildMessages(
    request: CompletionRequest
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }

    for (const msg of request.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    return messages;
  }
}
