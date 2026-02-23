// ─── OpenAI-kompatibler Provider ──────────────────────────────────────────
// Funktioniert für: openai, llamacpp, gemini, copilot, custom

import { AiProvider, AiChatMessage, AiChatOptions, AiChatResponse } from './types';
import { logger } from '../../logger';

export class OpenAiCompatibleProvider implements AiProvider {
  constructor(public readonly name: string) {}

  async chat(
    messages: AiChatMessage[],
    options: AiChatOptions,
    apiUrl: string,
    apiKey: string,
    model: string,
  ): Promise<AiChatResponse> {
    const startTime = Date.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const body: any = {
      model: options.model || model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 4096,
    };

    // JSON-Modus (OpenAI / llama.cpp unterstützen das)
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const timeoutMs = options.timeoutMs ?? 300_000;

    logger.debug(`[${this.name}] Chat → ${body.model}, ${messages.length} msgs, json=${!!options.jsonMode}`);

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`[${this.name}] HTTP ${resp.status}: ${text.substring(0, 300)}`);
    }

    const data = await resp.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    const durationMs = Date.now() - startTime;

    logger.debug(`[${this.name}] Antwort: ${content.length} Zeichen, ${durationMs}ms`);

    return {
      content,
      model: data.model || body.model,
      provider: this.name,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      durationMs,
      raw: data,
    };
  }
}
