/**
 * Gateway provider configuration types.
 */

export type ProviderType = 'anthropic' | 'openai' | 'gemini' | 'mistral';

export interface ProviderConfig {
  name: string;
  type: ProviderType;
  model: string;
  base_url?: string;
  key_ref?: string;
  timeout_ms: number;
  max_retries: number;
}

export interface GatewayConfig {
  default_provider: string;
  fallback_provider: string;
  timeout_ms: number;
  max_retries: number;
  providers: Record<string, ProviderConfig>;
}

export interface CompletionRequest {
  model?: string;
  messages: Message[];
  max_tokens: number;
  temperature: number;
  system?: string;
  stream: boolean;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResponse {
  id: string;
  content: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  finish_reason: string;
}

export interface CompletionChunk {
  id: string;
  delta: string;
  finish_reason?: string;
}
