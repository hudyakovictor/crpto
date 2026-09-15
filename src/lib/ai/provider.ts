/**
 * Провайдеры LLM. Порядок: OpenCode → NVIDIA NIM → любой OpenAI-совместимый.
 * Все три говорят по одному протоколу /chat/completions.
 * Если ни один не настроен или все упали — вызывающий код уходит в glassbox.
 */

export interface ProviderConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const SYSTEM_PROMPT = `Ты — главный квант-аналитик исследовательской лаборатории крипто-деривативов OKX с 15-летним опытом построения систематических стратегий.

ПРАВИЛА:
1. Пишешь ТОЛЬКО по-русски, плотно, как для профессионала на торговом деске.
2. Оперируешь ИСКЛЮЧИТЕЛЬНО числами из присланного контекста. Никаких выдуманных значений. Если данных мало — прямо пиши «выборка n=X недостаточна» и указывай, сколько нужно.
3. Отличаешь статистику от шума: Wilson lower bound важнее сырого hit-rate, expectancy после издержек важнее процента побед, n < 8 не является доказательством.
4. Каждый пункт ответа = конкретное действие с числом или проверяемый вывод. Запрещены общие фразы «следите за рынком», «важно учитывать риски».
5. Всегда учитываешь издержки: round-trip ≈ 24 bps (комиссия+проскальзывание+фандинг). Сигнал без ожидаемого хода ≥ 3× издержек экономически мёртв.
6. Учитываешь память лаборатории: не повторяешь дословно предыдущие разборы, а развиваешь или пересматриваешь их при новых данных.
7. Никаких вступлений, извинений, дисклеймеров и заключительных резюме. Только пронумерованные пункты.`;

export function resolveProviders(): ProviderConfig[] {
  const list: ProviderConfig[] = [];

  const opencode = process.env.OPENCODE_API_KEY;
  if (opencode) {
    list.push({
      id: "opencode",
      baseUrl: (process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/v1").replace(/\/$/, ""),
      apiKey: opencode,
      model: process.env.OPENCODE_MODEL || "claude-sonnet-4-5",
    });
  }

  const nvidia = process.env.NVIDIA_API_KEY;
  if (nvidia) {
    list.push({
      id: "nvidia-nim",
      baseUrl: (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""),
      apiKey: nvidia,
      model: process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct",
    });
  }

  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (baseUrl && apiKey) {
    list.push({
      id: "openai-compat",
      baseUrl: baseUrl.replace(/\/$/, ""),
      apiKey,
      model: process.env.LLM_MODEL || "gpt-4o-mini",
    });
  }

  return list;
}

export async function callProvider(
  p: ProviderConfig,
  userPrompt: string,
  timeoutMs = 28000
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 900,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${p.id} HTTP ${res.status} ${body.slice(0, 120)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json?.choices?.[0]?.message?.content;
    if (!text || typeof text !== "string" || text.trim().length < 20) {
      throw new Error(`${p.id}: пустой ответ модели`);
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Извлекает строку «ПАРАМЕТРЫ: EVS=..., категорий=..., гипотез=...» из ответа модели. */
export function parseParamsFromText(text: string): Partial<{
  minEvs: number;
  minCategories: number;
  maxHypothesesPerCycle: number;
}> {
  const out: Partial<{ minEvs: number; minCategories: number; maxHypothesesPerCycle: number }> = {};
  const evs = text.match(/EVS\s*[=:]\s*(\d{2,3})/i);
  if (evs) out.minEvs = Math.max(10, Math.min(95, Number(evs[1])));
  const cats = text.match(/категор\w*\s*[=:]\s*(\d)/i);
  if (cats) out.minCategories = Math.max(1, Math.min(5, Number(cats[1])));
  const hyp = text.match(/гипотез\w*\s*[=:]\s*(\d{1,3})/i);
  if (hyp) out.maxHypothesesPerCycle = Math.max(1, Math.min(100, Number(hyp[1])));
  return out;
}
