/**
 * OpenAI adapter — implements ModelClient for the OpenAI API.
 */

import OpenAI from 'openai';
import type { ModelClient } from './model_client.js';
import type {
  CompletionRequest,
  CompletionResponse,
  CompletionChunk,
  ProviderConfig,
} from '../types/provider_config.js';

export class OpenAIAdapter implements ModelClient {
  readonly provider = 'openai';
  private client: OpenAI;
  private model: string;

  constructor(config: ProviderConfig) {
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: config.key_ref ?? process.env.OPENAI_API_KEY,
      ...(config.base_url ? { baseURL: config.base_url } : {}),
      timeout: config.timeout_ms,
      maxRetries: config.max_retries,
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model ?? this.model;

    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }
    for (const msg of request.messages) {
      messages.push({
        role: msg.role,
        content: msg.content,
      } as OpenAI.ChatCompletionMessageParam);
    }

    const response = await this.client.chat.completions.create({
      model,
      messages,
      max_completion_tokens: request.max_tokens,
      temperature: request.temperature,
      stream: false,
    });

    const choice = response.choices[0];

    return {
      id: response.id,
      content: choice.message.content ?? '',
      model: response.model,
      usage: {
        prompt_tokens: response.usage?.prompt_tokens ?? 0,
        completion_tokens: response.usage?.completion_tokens ?? 0,
        total_tokens: response.usage?.total_tokens ?? 0,
      },
      finish_reason: choice.finish_reason ?? 'stop',
    };
  }

  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const model = request.model ?? this.model;

    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }
    for (const msg of request.messages) {
      messages.push({
        role: msg.role,
        content: msg.content,
      } as OpenAI.ChatCompletionMessageParam);
    }

    const stream = await this.client.chat.completions.create({
      model,
      messages,
      max_completion_tokens: request.max_tokens,
      temperature: request.temperature,
      stream: true,
    });

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      yield {
        id: chunk.id,
        delta: choice.delta?.content ?? '',
        ...(choice.finish_reason ? { finish_reason: choice.finish_reason } : {}),
      };
    }
  }

  countTokens(text: string): number {
    // Approximate token count: ~4 characters per token for English text.
    return Math.ceil(text.length / 4);
  }
}
