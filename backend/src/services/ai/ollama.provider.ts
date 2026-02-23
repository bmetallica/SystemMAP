// ─── Ollama Provider ──────────────────────────────────────────────────────
// Ollama hat ein eigenes API-Format: /api/generate + /api/chat

import { AiProvider, AiChatMessage, AiChatOptions, AiChatResponse } from './types';
import { logger } from '../../logger';

export class OllamaProvider implements AiProvider {
  readonly name = 'ollama';

  async chat(
    messages: AiChatMessage[],
    options: AiChatOptions,
    apiUrl: string,
    _apiKey: string,
    model: string,
  ): Promise<AiChatResponse> {
    const startTime = Date.now();
    const useModel = options.model || model;
    const timeoutMs = options.timeoutMs ?? 300_000;

    // Ollama /api/chat unterstützt Messages-Format direkt
    const chatUrl = apiUrl.replace(/\/api\/generate$/, '/api/chat');

    const body: any = {
      model: useModel,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.1,
        num_predict: options.maxTokens ?? 4096,
        num_ctx: options.contextWindow ?? 4096,
      },
    };

    if (options.jsonMode) {
      body.format = 'json';
    }

    logger.debug(`[ollama] Chat → ${useModel}, ${messages.length} msgs, json=${!!options.jsonMode}, timeout=${timeoutMs}ms, num_ctx=${options.contextWindow ?? 4096}`);

    // Ollama keep_alive: Modell nach 2 Min entladen (spart VRAM)
    body.keep_alive = '2m';

    // Doppelter Timeout: AbortController + Promise.race als Fallback
    const controller = new AbortController();
    const timer = setTimeout(() => {
      logger.warn(`[ollama] setTimeout-Timeout nach ${timeoutMs}ms, breche ab...`);
      controller.abort();
    }, timeoutMs);

    try {
      const fetchPromise = fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).then(async (resp) => {
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(`[ollama] HTTP ${resp.status}: ${text.substring(0, 300)}`);
        }
        return resp.json() as Promise<any>;
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`[ollama] Timeout nach ${timeoutMs / 1000}s – Modell "${useModel}" antwortet nicht.`)), timeoutMs + 1000);
      });

      const data = await Promise.race([fetchPromise, timeoutPromise]);
      const content = data.message?.content || data.response || '';
      const durationMs = Date.now() - startTime;

      logger.debug(`[ollama] Antwort: ${content.length} Zeichen, ${durationMs}ms`);

      return {
        content,
        model: data.model || useModel,
        provider: 'ollama',
        usage: data.prompt_eval_count ? {
          promptTokens: data.prompt_eval_count,
          completionTokens: data.eval_count,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        } : undefined,
        durationMs,
        raw: data,
      };
    } catch (err: any) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (err.name === 'AbortError' || err.name === 'TimeoutError' || err.message?.includes('Timeout')) {
        throw new Error(`[ollama] Timeout nach ${elapsed}s – Modell "${useModel}" antwortet nicht. Möglicherweise ist die Hardware zu langsam.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
