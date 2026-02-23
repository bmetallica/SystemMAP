// ─── Anthropic Claude Provider ────────────────────────────────────────────
// Claude nutzt ein eigenes API-Format mit x-api-key Header

import { AiProvider, AiChatMessage, AiChatOptions, AiChatResponse } from './types';
import { logger } from '../../logger';

export class ClaudeProvider implements AiProvider {
  readonly name = 'claude';

  async chat(
    messages: AiChatMessage[],
    options: AiChatOptions,
    apiUrl: string,
    apiKey: string,
    model: string,
  ): Promise<AiChatResponse> {
    const startTime = Date.now();
    const useModel = options.model || model;
    const timeoutMs = options.timeoutMs ?? 300_000;

    // Claude trennt system-Prompt von messages
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const body: any = {
      model: useModel,
      max_tokens: options.maxTokens ?? 4096,
      messages: chatMessages,
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    logger.debug(`[claude] Chat → ${useModel}, ${chatMessages.length} msgs`);

    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`[claude] HTTP ${resp.status}: ${text.substring(0, 300)}`);
    }

    const data = await resp.json() as any;
    const content = data.content?.[0]?.text || '';
    const durationMs = Date.now() - startTime;

    logger.debug(`[claude] Antwort: ${content.length} Zeichen, ${durationMs}ms`);

    return {
      content,
      model: data.model || useModel,
      provider: 'claude',
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      } : undefined,
      durationMs,
      raw: data,
    };
  }
}
