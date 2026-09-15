import { pool } from "@/db";
import type { ProviderConfig } from "./provider";

/**
 * Настройки ИИ-провайдеров: порядок цепочки, вкл/выкл, baseUrl, model, apiKey.
 * Хранятся в локальной таблице ai_provider_settings (профиль default).
 * Ключи из env имеют приоритет, если в настройках ключ не задан явно.
 * Клиенту ключи НЕ возвращаются — только флаги hasKey и источник.
 */

export const AI_PROVIDER_IDS = ["nvidia", "opencode", "gpt4free", "qwen-local"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiProviderMeta {
  id: AiProviderId;
  titleRu: string;
  hintRu: string;
  needsKey: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  envKey?: string;
  defaultTimeoutMs: number;
  /** Дополнительные поля тела /chat/completions (например { think: false } для thinking-моделей Ollama). */
  chatExtra?: Record<string, unknown>;
  /** Упрощённый системный промпт для маленьких локальных моделей (иначе строгий промпт вводит их в ступор). */
  systemPrompt?: string;
  /** Лимит токенов ответа (thinking-моделям нужно больше — мышление съедает бюджет). */
  maxTokens?: number;
}

export const QWEN_LOCAL_SYSTEM_PROMPT = `Ты — квант-аналитик крипто-исследовательской лаборатории. Пиши ТОЛЬКО по-русски, только пронумерованные пункты без вступлений.
Используй ИСКЛЮЧИТЕЛЬНО числа из присланного контекста, ничего не выдумывай. Если данных мало — так и напиши.
Учитывай издержки round-trip около 24 bps. Не давай инвестиционных рекомендаций.`;

export const AI_PROVIDER_META: Record<AiProviderId, AiProviderMeta> = {
  nvidia: {
    id: "nvidia",
    titleRu: "NVIDIA NIM",
    hintRu: "Облако NVIDIA. Ключ: env NVIDIA_API_KEY.",
    needsKey: true,
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.3-70b-instruct",
    envKey: "NVIDIA_API_KEY",
    defaultTimeoutMs: 28000,
  },
  opencode: {
    id: "opencode",
    titleRu: "OpenCode Zen",
    hintRu: "Шлюз opencode.ai/zen. Ключ: env OPENCODE_API_KEY.",
    needsKey: true,
    defaultBaseUrl: "https://opencode.ai/zen/v1",
    defaultModel: "claude-sonnet-4-5",
    envKey: "OPENCODE_API_KEY",
    defaultTimeoutMs: 28000,
  },
  gpt4free: {
    id: "gpt4free",
    titleRu: "GPT4Free",
    hintRu: "Бесплатный фолбэк, ключ не нужен. Качество ниже — только резерв.",
    needsKey: false,
    defaultBaseUrl: "https://api.gpt4free.co/v1",
    defaultModel: "gpt-3.5-turbo",
    defaultTimeoutMs: 28000,
  },
  "qwen-local": {
    id: "qwen-local",
    titleRu: "Qwen (local)",
    hintRu: "Локальный Ollama: http://localhost:11434/v1, модель qwen2.5:7b. Ключ обычно не нужен.",
    needsKey: false,
    defaultBaseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen2.5:7b",
    defaultTimeoutMs: 240000,
    chatExtra: { think: false },
    systemPrompt: QWEN_LOCAL_SYSTEM_PROMPT,
    maxTokens: 2048,
  },
};

export interface AiProviderOverride {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface AiSettingsState {
  order: AiProviderId[];
  enabled: AiProviderId[];
  configs: Partial<Record<AiProviderId, AiProviderOverride>>;
}

export interface AiProviderPublic {
  id: AiProviderId;
  titleRu: string;
  hintRu: string;
  needsKey: boolean;
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  keySource: "env" | "settings" | "none";
  hasKey: boolean;
}

function sanitizeUrl(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim().replace(/\/$/, "").slice(0, 200);
  if (!/^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(\/.*)?$/.test(s)) return fallback;
  return s;
}

function sanitizeModel(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim().slice(0, 120);
  if (!/^[A-Za-z0-9._:/-]+$/.test(s)) return fallback;
  return s;
}

function sanitizeKey(v: unknown): string {
  if (typeof v !== "string") return "";
  const s = v.trim().slice(0, 500);
  if (/[\r\n]/.test(s)) return "";
  return s;
}

function normalizeOrder(v: unknown): AiProviderId[] {
  const seen = new Set<AiProviderId>();
  const out: AiProviderId[] = [];
  if (Array.isArray(v)) {
    for (const x of v) {
      if (typeof x === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(x)) {
        const id = x as AiProviderId;
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    }
  }
  for (const id of AI_PROVIDER_IDS) if (!seen.has(id)) out.push(id);
  return out;
}

let ensurePromise: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = pool
      .query(
        `CREATE TABLE IF NOT EXISTS ai_provider_settings (
          id SERIAL PRIMARY KEY,
          profile TEXT NOT NULL DEFAULT 'default' UNIQUE,
          provider_order TEXT NOT NULL DEFAULT 'nvidia,opencode,gpt4free,qwen-local',
          enabled TEXT NOT NULL DEFAULT 'nvidia,opencode,gpt4free,qwen-local',
          configs JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`
      )
      .then(() => undefined)
      .catch((e) => {
        ensurePromise = null;
        throw e;
      });
  }
  return ensurePromise;
}

interface SettingsRow {
  provider_order: string;
  enabled: string;
  configs: unknown;
}

async function loadRow(): Promise<SettingsRow> {
  await ensureTable();
  const { rows } = await pool.query<SettingsRow>(
    `SELECT provider_order, enabled, configs FROM ai_provider_settings WHERE profile = 'default' LIMIT 1`
  );
  if (rows.length > 0) return rows[0];
  const created = await pool.query<SettingsRow>(
    `INSERT INTO ai_provider_settings (profile) VALUES ('default')
     ON CONFLICT (profile) DO NOTHING RETURNING provider_order, enabled, configs`
  );
  if (created.rows.length > 0) return created.rows[0];
  const again = await pool.query<SettingsRow>(
    `SELECT provider_order, enabled, configs FROM ai_provider_settings WHERE profile = 'default' LIMIT 1`
  );
  return again.rows[0];
}

function toState(row: SettingsRow): AiSettingsState {
  const order = normalizeOrder(
    typeof row.provider_order === "string" ? row.provider_order.split(",").map((s) => s.trim()) : []
  );
  const enabledRaw =
    typeof row.enabled === "string" ? row.enabled.split(",").map((s) => s.trim()) : [];
  const enabled = order.filter((id) => enabledRaw.includes(id));
  const configs: AiSettingsState["configs"] = {};
  const raw = (row.configs ?? {}) as Record<string, unknown>;
  for (const id of AI_PROVIDER_IDS) {
    const c = raw[id];
    if (c && typeof c === "object") {
      const o = c as Record<string, unknown>;
      const override: AiProviderOverride = {};
      if (typeof o.baseUrl === "string") override.baseUrl = sanitizeUrl(o.baseUrl, AI_PROVIDER_META[id].defaultBaseUrl);
      if (typeof o.model === "string") override.model = sanitizeModel(o.model, AI_PROVIDER_META[id].defaultModel);
      if (typeof o.apiKey === "string" && o.apiKey) override.apiKey = sanitizeKey(o.apiKey);
      if (Object.keys(override).length > 0) configs[id] = override;
    }
  }
  return { order, enabled, configs };
}

/** Публичное состояние для UI: без ключей, только флаги. */
export async function loadAiSettingsPublic(): Promise<{ providers: AiProviderPublic[]; updatedAt: string }> {
  await ensureTable();
  const row = await loadRow();
  const state = toState(row);
  const { rows } = await pool.query<{ updated_at: string }>(
    `SELECT updated_at FROM ai_provider_settings WHERE profile = 'default' LIMIT 1`
  );
  const providers = state.order.map((id) => toPublic(id, state));
  return { providers, updatedAt: rows[0] ? new Date(rows[0].updated_at).toISOString() : new Date().toISOString() };
}

function effectiveKey(id: AiProviderId, state: AiSettingsState): { key: string; source: "env" | "settings" | "none" } {
  const fromSettings = state.configs[id]?.apiKey ?? "";
  if (fromSettings) return { key: fromSettings, source: "settings" };
  const envName = AI_PROVIDER_META[id].envKey;
  if (envName && process.env[envName]) return { key: process.env[envName] as string, source: "env" };
  return { key: "", source: "none" };
}

function toPublic(id: AiProviderId, state: AiSettingsState): AiProviderPublic {
  const meta = AI_PROVIDER_META[id];
  const ov = state.configs[id] ?? {};
  const { key, source } = effectiveKey(id, state);
  return {
    id,
    titleRu: meta.titleRu,
    hintRu: meta.hintRu,
    needsKey: meta.needsKey,
    enabled: state.enabled.includes(id),
    baseUrl: ov.baseUrl ?? process.env[`${envPrefix(id)}_BASE_URL`] ?? meta.defaultBaseUrl,
    model: ov.model ?? process.env[`${envPrefix(id)}_MODEL`] ?? meta.defaultModel,
    timeoutMs: meta.defaultTimeoutMs,
    keySource: meta.needsKey ? source : key ? source : "none",
    hasKey: meta.needsKey ? key.length > 0 : true,
  };
}

function envPrefix(id: AiProviderId): string {
  switch (id) {
    case "nvidia":
      return "NVIDIA";
    case "opencode":
      return "OPENCODE";
    case "gpt4free":
      return "GPT4FREE";
    case "qwen-local":
      return "QWEN_LOCAL";
  }
}

/** Цепочка провайдеров для вызовов LLM — в порядке из настроек, только включённые. */
export async function resolveProvidersFromSettings(): Promise<
  (ProviderConfig & {
    timeoutMs: number;
    chatExtra?: Record<string, unknown>;
    systemPrompt?: string;
    maxTokens?: number;
  })[]
> {
  const row = await loadRow();
  const state = toState(row);
  const out: (ProviderConfig & {
    timeoutMs: number;
    chatExtra?: Record<string, unknown>;
    systemPrompt?: string;
    maxTokens?: number;
  })[] = [];
  for (const id of state.order) {
    if (!state.enabled.includes(id)) continue;
    const meta = AI_PROVIDER_META[id];
    const ov = state.configs[id] ?? {};
    const baseUrl = sanitizeUrl(
      ov.baseUrl ?? process.env[`${envPrefix(id)}_BASE_URL`] ?? meta.defaultBaseUrl,
      meta.defaultBaseUrl
    );
    const model = sanitizeModel(
      ov.model ?? process.env[`${envPrefix(id)}_MODEL`] ?? meta.defaultModel,
      meta.defaultModel
    );
    const { key } = effectiveKey(id, state);
    if (meta.needsKey && !key) continue; // пропускаем провайдеры без ключа
    out.push({
      id,
      baseUrl,
      apiKey: key,
      model,
      timeoutMs: meta.defaultTimeoutMs,
      chatExtra: meta.chatExtra,
      systemPrompt: meta.systemPrompt,
      maxTokens: meta.maxTokens,
    });
  }
  return out;
}

export interface SaveAiSettingsInput {
  order?: unknown;
  enabled?: unknown;
  configs?: unknown;
}

export async function saveAiSettings(body: SaveAiSettingsInput): Promise<{ providers: AiProviderPublic[] }> {
  await ensureTable();
  await loadRow();
  const patch: { provider_order?: string; enabled?: string; configs?: string } = {};
  let order = normalizeOrder(undefined);
  if (body.order !== undefined) {
    order = normalizeOrder(body.order);
    patch.provider_order = order.join(",");
  } else {
    const current = toState(await loadRow());
    order = current.order;
  }
  if (body.enabled !== undefined) {
    if (!Array.isArray(body.enabled)) throw new Error("enabled должен быть массивом id провайдеров");
    const ids = (body.enabled as unknown[]).filter(
      (x): x is AiProviderId => typeof x === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(x)
    );
    if (ids.length === 0) throw new Error("Нельзя выключить всех провайдеров — оставьте хотя бы один");
    const uniq = order.filter((id) => ids.includes(id));
    patch.enabled = uniq.join(",");
  }
  if (body.configs !== undefined) {
    if (typeof body.configs !== "object" || body.configs === null || Array.isArray(body.configs)) {
      throw new Error("configs должен быть объектом");
    }
    const clean: Record<string, { baseUrl?: string; model?: string; apiKey?: string; clearKey?: boolean }> = {};
    for (const [rawId, rawCfg] of Object.entries(body.configs as Record<string, unknown>)) {
      if (!(AI_PROVIDER_IDS as readonly string[]).includes(rawId)) continue;
      if (typeof rawCfg !== "object" || rawCfg === null) continue;
      const c = rawCfg as Record<string, unknown>;
      const entry: { baseUrl?: string; model?: string; apiKey?: string; clearKey?: boolean } = {};
      const id = rawId as AiProviderId;
      if (c.baseUrl !== undefined) entry.baseUrl = sanitizeUrl(c.baseUrl, AI_PROVIDER_META[id].defaultBaseUrl);
      if (c.model !== undefined) entry.model = sanitizeModel(c.model, AI_PROVIDER_META[id].defaultModel);
      if (c.apiKey !== undefined) {
        if (c.apiKey === "" || c.apiKey === null) entry.clearKey = true;
        else entry.apiKey = sanitizeKey(c.apiKey);
      }
      if (Object.keys(entry).length > 0) clean[id] = entry;
    }
    // Мержим с существующими: подтягиваем текущие configs, применяем патч
    const current = toState(await loadRow());
    const merged: Record<string, unknown> = { ...(current.configs as Record<string, unknown>) };
    for (const [id, entry] of Object.entries(clean)) {
      const prev = (merged[id] ?? {}) as Record<string, unknown>;
      const next: Record<string, unknown> = { ...prev };
      if (entry.baseUrl !== undefined) next.baseUrl = entry.baseUrl;
      if (entry.model !== undefined) next.model = entry.model;
      if (entry.clearKey) delete next.apiKey;
      else if (entry.apiKey !== undefined) next.apiKey = entry.apiKey;
      merged[id] = next;
    }
    patch.configs = JSON.stringify(merged);
  }
  if (Object.keys(patch).length > 0) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (patch.provider_order !== undefined) {
      sets.push(`provider_order = $${i++}`);
      vals.push(patch.provider_order);
    }
    if (patch.enabled !== undefined) {
      sets.push(`enabled = $${i++}`);
      vals.push(patch.enabled);
    }
    if (patch.configs !== undefined) {
      sets.push(`configs = $${i++}::jsonb`);
      vals.push(patch.configs);
    }
    sets.push(`updated_at = NOW()`);
    await pool.query(`UPDATE ai_provider_settings SET ${sets.join(", ")} WHERE profile = 'default'`, vals);
  }
  const { providers } = await loadAiSettingsPublic();
  return { providers };
}
