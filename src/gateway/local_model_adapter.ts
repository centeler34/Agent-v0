/**
 * Local model adapter — for LM Studio and Ollama local AI backends.
 *
 * LM Studio API:
 *   GET  /api/v1/models                        — List loaded models
 *   POST /api/v1/chat                           — Chat completion
 *   POST /api/v1/models/load                    — Load a model into memory
 *   POST /api/v1/models/download                — Download a model
 *   GET  /api/v1/models/download/status/:job_id — Check download progress
 *
 * Ollama API (fallback):
 *   GET  /api/tags                              — List models
 *   POST /api/chat                              — Chat completion
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

  constructor(config: ProviderConfig) {
    this.provider = config.type; // 'ollama' or 'lmstudio'
    this.model = config.model;
    this.baseUrl = (config.base_url ?? this.defaultUrl()).replace(/\/+$/, '');
    this.timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  }

  private defaultUrl(): string {
    return this.provider === 'lmstudio'
      ? 'http://localhost:1234'
      : 'http://localhost:11434';
  }

  // ── Connection Testing ──────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; message: string; models?: string[] }> {
    try {
      const modelsUrl = this.provider === 'ollama'
        ? `${this.baseUrl}/api/tags`
        : `${this.baseUrl}/api/v1/models`;

      const res = await fetch(modelsUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });

      if (!res.ok) {
        return { ok: false, message: `${this.provider} responded with HTTP ${res.status} at ${modelsUrl}` };
      }

      const data: any = await res.json();
      const models: string[] = [];

      if (this.provider === 'ollama' && data.models) {
        for (const m of data.models) models.push(m.name || m.model);
      } else if (data.data) {
        // LM Studio /api/v1/models returns { data: [...] }
        for (const m of data.data) models.push(m.id || m.model);
      } else if (Array.isArray(data)) {
        for (const m of data) models.push(m.id || m.model || m);
      }

      return {
        ok: true,
        message: `Connected to ${this.provider} at ${this.baseUrl}`,
        models: models.length > 0 ? models : undefined,
      };
    } catch (err: any) {
      return { ok: false, message: this.diagnoseError(err) };
    }
  }

  // ── Model Management (LM Studio) ───────────────────────────────────────

  /**
   * List available models.
   * LM Studio: GET /api/v1/models
   * Ollama:    GET /api/tags
   */
  async listModels(): Promise<string[]> {
    const url = this.provider === 'ollama'
      ? `${this.baseUrl}/api/tags`
      : `${this.baseUrl}/api/v1/models`;

    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`Failed to list models: HTTP ${res.status}`);

    const data: any = await res.json();
    const models: string[] = [];

    if (this.provider === 'ollama' && data.models) {
      for (const m of data.models) models.push(m.name || m.model);
    } else if (data.data) {
      for (const m of data.data) models.push(m.id || m.model);
    } else if (Array.isArray(data)) {
      for (const m of data) models.push(m.id || m.model || m);
    }

    return models;
  }

  /**
   * Load a model into memory.
   * LM Studio: POST /api/v1/models/load
   * Ollama:    POST /api/generate (with keep_alive)
   */
  async loadModel(modelName?: string): Promise<{ ok: boolean; message: string }> {
    const name = modelName ?? this.model;

    if (this.provider === 'lmstudio') {
      const res = await fetch(`${this.baseUrl}/api/v1/models/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, message: `Failed to load model: HTTP ${res.status} — ${body}` };
      }
      return { ok: true, message: `Model "${name}" loaded` };
    }

    // Ollama: pull to ensure available
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, message: `Failed to load model: HTTP ${res.status} — ${body}` };
    }
    return { ok: true, message: `Model "${name}" loaded` };
  }

  /**
   * Download a model.
   * LM Studio: POST /api/v1/models/download — returns job_id
   * Ollama:    POST /api/pull (streaming status)
   */
  async downloadModel(modelName: string): Promise<{ jobId?: string; message: string }> {
    if (this.provider === 'lmstudio') {
      const res = await fetch(`${this.baseUrl}/api/v1/models/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName }),
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Download failed: HTTP ${res.status} — ${body}`);
      }

      const data: any = await res.json();
      return { jobId: data.job_id || data.id, message: `Download started for "${modelName}"` };
    }

    // Ollama: streaming pull
    return { message: `Use 'agent-cyplex model pull ${modelName}' for Ollama downloads` };
  }

  /**
   * Check download progress (LM Studio only).
   * GET /api/v1/models/download/status/:job_id
   */
  async downloadStatus(jobId: string): Promise<{ status: string; progress?: number; message: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/models/download/status/${jobId}`, {
      method: 'GET',
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Status check failed: HTTP ${res.status}`);
    }

    const data: any = await res.json();
    return {
      status: data.status || 'unknown',
      progress: data.progress,
      message: data.message || data.status || 'unknown',
    };
  }

  // ── Chat Completion ─────────────────────────────────────────────────────

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model ?? this.model;
    const messages = this.buildMessages(request);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let url: string;
      let body: string;

      if (this.provider === 'lmstudio') {
        // LM Studio: POST /api/v1/chat
        url = `${this.baseUrl}/api/v1/chat`;
        body = JSON.stringify({
          model,
          messages,
          max_tokens: request.max_tokens,
          temperature: request.temperature,
          stream: false,
        });
      } else {
        // Ollama: POST /api/chat
        url = `${this.baseUrl}/api/chat`;
        body = JSON.stringify({
          model,
          messages,
          stream: false,
          options: {
            temperature: request.temperature,
            num_predict: request.max_tokens,
          },
        });
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`${this.provider} API error (${res.status}): ${errBody}`);
      }

      const data: any = await res.json();

      if (this.provider === 'ollama') {
        // Ollama native response
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

      // LM Studio response (OpenAI-compatible format)
      const choice = data.choices?.[0];
      return {
        id: data.id ?? `lmstudio-${Date.now()}`,
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
      throw new Error(this.diagnoseError(err));
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Streaming ───────────────────────────────────────────────────────────

  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const model = request.model ?? this.model;
    const messages = this.buildMessages(request);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let url: string;
      let body: string;

      if (this.provider === 'lmstudio') {
        url = `${this.baseUrl}/api/v1/chat`;
        body = JSON.stringify({
          model,
          messages,
          max_tokens: request.max_tokens,
          temperature: request.temperature,
          stream: true,
        });
      } else {
        url = `${this.baseUrl}/api/chat`;
        body = JSON.stringify({
          model,
          messages,
          stream: true,
          options: {
            temperature: request.temperature,
            num_predict: request.max_tokens,
          },
        });
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`${this.provider} API error (${res.status}): ${errBody}`);
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

          if (this.provider === 'ollama') {
            // Ollama streams JSON objects per line (no SSE prefix)
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

          // LM Studio: SSE format with "data: " prefix
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') return;

          try {
            const data = JSON.parse(payload);
            const choice = data.choices?.[0];
            if (!choice) continue;

            yield {
              id: data.id ?? `lmstudio-${Date.now()}`,
              delta: choice.delta?.content ?? '',
              ...(choice.finish_reason ? { finish_reason: choice.finish_reason } : {}),
            };
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err: any) {
      throw new Error(this.diagnoseError(err));
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Utilities ───────────────────────────────────────────────────────────

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

  private diagnoseError(err: any): string {
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
      return `${this.provider} request timed out after ${this.timeoutMs}ms. The model may be loading — try again.`;
    }
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      return `Connection refused at ${this.baseUrl}. Make sure ${this.provider} is running` +
        (this.provider === 'ollama' ? ': ollama serve' : ': Open LM Studio → Start Server');
    }
    if (err.cause?.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
      return `Host not found: ${this.baseUrl}. Check the URL is correct.`;
    }
    return err.message || String(err);
  }
}
