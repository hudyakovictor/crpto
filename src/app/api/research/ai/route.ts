import { NextResponse } from "next/server";
import { db } from "@/db";
import { aiAnalyses } from "@/db/schema";
import { desc } from "drizzle-orm";
import { AI_SCOPES, SCOPE_META, buildContext, type AiScope } from "@/lib/ai/context";
import {
  FOLLOWUP_SYSTEM_PROMPT,
  SMALLTALK_SYSTEM_PROMPT,
  callProvider,
  isSmallTalkQuestion,
  parseParamsFromText,
} from "@/lib/ai/provider";
import { loadFilters } from "@/lib/filters";
import { loadAiSettingsPublic, resolveProvidersFromSettings } from "@/lib/ai/settings";
import { glassboxAnalyze } from "@/lib/ai/glassbox";
import { GLASSBOX_PROVIDER_ID, isOnlineProvider } from "@/lib/ui-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ---------- GET: каталог + история ---------- */

export async function GET() {
  try {
    const providers = await resolveProvidersFromSettings();
    const { providers: settings } = await loadAiSettingsPublic();
    const history = await db.select().from(aiAnalyses).orderBy(desc(aiAnalyses.createdAt)).limit(20);
    return NextResponse.json({
      success: true,
      provider: providers.length
        ? { id: providers[0].id, model: providers[0].model, live: true, chain: providers.map((p) => p.id) }
        : { id: GLASSBOX_PROVIDER_ID, model: "rule-engine v4", live: false, chain: [GLASSBOX_PROVIDER_ID] },
      aiSettings: settings,
      promptCatalog: AI_SCOPES.map((k) => ({
        key: k,
        title: SCOPE_META[k].title,
        panel: SCOPE_META[k].panel,
        descRu: SCOPE_META[k].descRu,
      })),
      history,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI status failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/* ---------- POST: запуск анализа с изолированным контекстом ---------- */

export async function POST(req: Request) {
  try {
    let body: { scope?: string; kind?: string; note?: string };
    try {
      body = (await req.json()) as { scope?: string; kind?: string; note?: string };
    } catch {
      return NextResponse.json({ success: false, error: "Некорректный JSON в теле запроса" }, { status: 400 });
    }
    if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000)) {
      return NextResponse.json({ success: false, error: "note должен быть строкой до 2000 символов" }, { status: 400 });
    }
    const raw = body.scope || body.kind || "signal_today";
    const scope: AiScope = (AI_SCOPES as readonly string[]).includes(raw) ? (raw as AiScope) : "signal_today";

    const noteText = body.note?.trim() ?? "";

    // Бытовая болтовня («ты тут?», «спасибо»): контекст базы НЕ отправляется,
    // отвечает коротко, в память лаборатории не пишется как разбор.
    if (isSmallTalkQuestion(noteText)) {
      const providers = await resolveProvidersFromSettings();
      let content = "";
      let usedProvider = GLASSBOX_PROVIDER_ID;
      let usedModel: string | null = "rule-engine v4";
      const errors: string[] = [];
      for (const p of providers) {
        try {
          content = await callProvider(
            p,
            `Сообщение пользователя: "${noteText}"`,
            Math.min(p.timeoutMs ?? 28000, 60000),
            SMALLTALK_SYSTEM_PROMPT
          );
          usedProvider = p.id;
          usedModel = p.model;
          break;
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (!content)
        content = "На связи. Внешняя модель сейчас недоступна (офлайн) — спросите про сигналы, и дам разбор по цифрам из базы.";
      const current = await loadFilters();
      const [saved] = await db
        .insert(aiAnalyses)
        .values({
          kind: "smalltalk",
          title: "Свободный вопрос",
          content,
          provider: usedProvider,
          model: usedModel,
          contextJson: {
            scope,
            smalltalk: true,
            note: noteText,
            llmError: errors.length ? errors.join(" | ").slice(0, 500) : null,
          },
          createdAt: new Date(),
        })
        .returning();
      return NextResponse.json({
        success: true,
        analysis: saved,
        provider: {
          id: usedProvider,
          model: usedModel,
          live: isOnlineProvider(usedProvider),
          chain: [...providers.map((p) => p.id), GLASSBOX_PROVIDER_ID],
        },
        llmError: errors.length ? errors.join(" | ") : null,
        contextChars: noteText.length,
        stats: { resolved: 0, hitRate: 0, brier: 0, pnl: 0, goalPct: 0 },
        contextStats: { resolvedForecasts: 0, hitRate: 0, topCombo: null },
        current,
        recommended: { ...current, rationale: [] as string[] },
        rationale: [] as string[],
      });
    }

    // Свободный вопрос в чате (есть note): живой ответ без строгого шаблона.
    // Строгий шаблон применяется только к первому анализу scope.
    const isFollowUp = noteText.length > 0;

    const ctx = await buildContext(scope, body.note);
    const providers = await resolveProvidersFromSettings();

    let content = "";
    let usedProvider = GLASSBOX_PROVIDER_ID;
    let usedModel: string | null = "rule-engine v4";
    const errors: string[] = [];

    for (const p of providers) {
      try {
        content = await callProvider(p, ctx.text, p.timeoutMs ?? 28000, isFollowUp ? FOLLOWUP_SYSTEM_PROMPT : undefined);
        usedProvider = p.id;
        usedModel = p.model;
        break;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (!content) content = glassboxAnalyze(scope, ctx.facts, ctx.recommended, ctx.stats);

    // Итоговые параметры: рекомендация движка, уточнённая моделью.
    // Для свободных вопросов парсинг отключён — болтовня в чате не должна менять параметры.
    const fromText = isFollowUp ? {} : parseParamsFromText(content);
    const applied = {
      ...ctx.recommended,
      ...fromText,
    };

    const [saved] = await db
      .insert(aiAnalyses)
      .values({
        kind: scope,
        title: SCOPE_META[scope].title,
        content,
        provider: usedProvider,
        model: usedModel,
        contextJson: {
          scope,
          panel: SCOPE_META[scope].panel,
          contextChars: ctx.text.length,
          stats: ctx.stats,
          note: body.note ?? null,
          // Причина офлайн-фолбэка — чтобы в журнале было видно, почему ответил glassbox.
          llmError: errors.length ? errors.join(" | ").slice(0, 500) : null,
        },
        createdAt: new Date(),
      })
      .returning();

    return NextResponse.json({
      success: true,
      analysis: saved,
      provider: {
        id: usedProvider,
        model: usedModel,
        live: isOnlineProvider(usedProvider),
        chain: [...providers.map((p) => p.id), GLASSBOX_PROVIDER_ID],
      },
      llmError: errors.length ? errors.join(" | ") : null,
      contextChars: ctx.text.length,
      stats: ctx.stats,
      contextStats: {
        resolvedForecasts: ctx.stats.resolved,
        hitRate: ctx.stats.hitRate,
        topCombo: ctx.facts.combos[0]?.code ?? null,
      },
      current: ctx.current,
      recommended: applied,
      rationale: ctx.recommended.rationale,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI analysis failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
