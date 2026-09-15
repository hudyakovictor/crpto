"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  Bot,
  Braces,
  CircleDot,
  Cpu,
  KeyRound,
  Loader2,
  Play,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import type { ApiState } from "../data";
import { useAiDock } from "../ai-dock";
import { postJson, toast } from "../data";
import type { AiAnalysisRow, AiRunResponse, AiStatusResponse } from "@/lib/ui-types";
import { fmtClock, timeAgo } from "@/lib/format";
import { EmptyState, ErrorState, Panel, Pill, SkeletonRows, Tip, TipRow,
  ViewGuide,
} from "../ui";

const KIND_TONE: Record<string, "bull" | "bear" | "info" | "warn" | "accent"> = {
  signal_today: "bull",
  combo_audit: "accent",
  edge_critic: "warn",
  regime_playbook: "info",
  postmortem: "bear",
  risk_gate: "bull",
  hypothesis_writer: "accent",
};

const KIND_RU: Record<string, string> = {
  signal_today: "ГЛАВНЫЙ СИГНАЛ",
  combo_audit: "АУДИТ КОМБО",
  edge_critic: "КРИТИК EDGE",
  regime_playbook: "ПЛЕЙБУК РЕЖИМА",
  postmortem: "РАЗБОР ПРОМАХОВ",
  risk_gate: "PRE-TRADE GATE",
  hypothesis_writer: "НОВАЯ ГИПОТЕЗА",
};

/** Рендер аналитической карточки: нумерованные пункты — плотно и читаемо. */
function AnalysisCard({ a, fresh }: { a: AiAnalysisRow; fresh?: boolean }) {
  const lines = a.content.split("\n").filter((l) => l.trim().length > 0);
  return (
    <article
      className={`rounded-[10px] border bg-surface2 p-3.5 ${fresh ? "border-[rgba(91,141,238,0.4)]" : "border-border"}`}
    >
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <Pill tone={KIND_TONE[a.kind] ?? "neutral"}>{KIND_RU[a.kind] ?? a.kind}</Pill>
        <h3 className="text-[15px] font-semibold text-text-1">{a.title}</h3>
        <span className="min-w-0 flex-1" />
        <Tip
          align="end"
          label={
            <div>
              <TipRow k="Движок" v={a.provider} />
              <TipRow k="Модель" v={a.model ?? "—"} />
              <TipRow k="Создан" v={fmtClock(a.createdAt)} />
            </div>
          }
        >
          <span className="num cursor-help text-[13px] text-text-3">{timeAgo(a.createdAt)}</span>
        </Tip>
      </header>
      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <p key={i} className="text-[14px] leading-relaxed text-text-2">
            {l}
          </p>
        ))}
      </div>
    </article>
  );
}

export function CopilotView({ ai }: { ai: ApiState<AiStatusResponse> }) {
  const dock = useAiDock();
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [freshRuns, setFreshRuns] = useState<AiAnalysisRow[]>([]);
  const d = ai.data;

  const run = useCallback(
    async (kind: string, title: string) => {
      if (busyKind) return;
      setBusyKind(kind);
      try {
        const r = await postJson<AiRunResponse>("/api/research/ai", { kind });
        setFreshRuns((prev) => [r.analysis, ...prev].slice(0, 12));
        if (r.llmError) {
          toast("info", "LLM недоступен — glassbox-разбор", `${title}: ${r.llmError}`);
        } else {
          toast(
            "ok",
            `Анализ «${title}» готов`,
            `${r.provider.live ? `LLM: ${r.provider.model}` : "Локальный движок"} · контекст: ${r.contextStats.resolvedForecasts} прогнозов, HR ${r.contextStats.hitRate}%`
          );
        }
      } catch (e) {
        toast("err", "Сбой анализа", e instanceof Error ? e.message : "неизвестно");
      } finally {
        setBusyKind(null);
      }
    },
    [busyKind]
  );

  const feed = useMemo(() => {
    const historic = (d?.history ?? []).filter((h) => !freshRuns.some((f) => f.id === h.id));
    return [...freshRuns, ...historic].slice(0, 12);
  }, [freshRuns, d?.history]);

  const latestSignal = feed.find((a) => a.kind === "signal_today");

  return (
    <div className="mx-auto grid max-w-[1920px] gap-4 p-5 anim-fade-up">
      <ViewGuide
        right={<AiButtonLocal onClick={() => dock.open("signal_today", "Главный сигнал сейчас")} />}
        note="Любая кнопка ▶ открывает диалог: ИИ отвечает по изолированному контексту, предлагает параметры, вы правите ползунки и запускаете цикл."
        accent="AI Копилот · аналитик"
        steps={[
          { t: "Слева — брифинг дежурного", d: "ответ на «что главное прямо сейчас» одним нажатием кнопки" },
          { t: "7 изолированных промптов", d: "каждый получает только свои цифры из базы — без галлюцинаций и воды" },
          { t: "Разборы копятся в журнале", d: "с меткой движка и модели — исследовательская память лаборатории" },
        ]}
      />

      {/* ── Row 1: briefing hero + provider status ── */}
      <div className="grid gap-3 xl:grid-cols-12">
        <Panel
          title="Брифинг дежурного аналитика"
          sub="актуальный ответ на «что главное прямо сейчас» — без ручного скроллинга всех экранов"
          className="xl:col-span-8"
          actions={<Sparkles className="size-3.5 text-accent" strokeWidth={1.8} />}
        >
          {ai.loading && !d ? (
            <SkeletonRows rows={4} height={26} />
          ) : ai.error && !d ? (
            <ErrorState message={ai.error} onRetry={() => void ai.refresh()} />
          ) : latestSignal ? (
            <AnalysisCard a={latestSignal} />
          ) : (
            <EmptyState
              icon={<Zap className="size-4.5" strokeWidth={1.6} />}
              title="Брифинг ещё не сгенерирован"
              text="Нажмите «Главный сигнал сейчас» ниже — движок соберёт изолированный контекст из базы (топ-комбо, лидерборд, веса, rolling) и выдаст вердикт за секунды."
              action={
                <button
                  onClick={() => void run("signal_today", "Главный сигнал сейчас")}
                  disabled={!!busyKind}
                  className="hoverable pressable flex items-center gap-2 rounded-md border border-[rgba(91,141,238,0.5)] bg-accent px-3.5 py-2 text-[14px] font-semibold text-white hover:bg-[#6d9bf3] disabled:opacity-60"
                >
                  {busyKind === "signal_today" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" fill="currentColor" strokeWidth={0} />}
                  Сгенерировать брифинг
                </button>
              }
            />
          )}
        </Panel>

        <Panel title="Провайдер и изоляция промптов" sub="прозрачность конвейера" className="xl:col-span-4">
          <div className="flex h-full flex-col gap-3">
            <div className="flex items-center justify-between rounded-md border border-border bg-surface2 px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <Cpu className="size-4 text-text-3" strokeWidth={1.8} />
                <div>
                  <div className="text-[14px] font-medium text-text-1">
                    {d?.provider.live ? "Внешняя LLM подключена" : "Локальный glassbox-движок"}
                  </div>
                  <div className="num text-[13px] text-text-3">
                    {d?.provider.id ?? "—"} · {d?.provider.model ?? "—"}
                  </div>
                </div>
              </div>
              <Pill tone={d?.provider.live ? "bull" : "warn"} dot>
                {d?.provider.live ? "LLM LIVE" : "LOCAL"}
              </Pill>
            </div>

            <div className="rounded-md border border-border bg-surface2 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-text-3">
                <Braces className="size-3" strokeWidth={2} />
                Почему изолированные промпты
              </div>
              <p className="text-[13px] leading-relaxed text-text-3">
                Каждый анализ получает <span className="text-text-2">замкнутый пакет контекста</span> — только те числа, что нужны именно этой
                задаче, и жёсткий формат ответа. Это убирает галлюцинации от лишнего контекста, делает вызовы дешёвыми,
                предсказуемыми и полностью аудируемыми: любой разбор можно воспроизвести из лога.
              </p>
            </div>

            <div className="rounded-md border border-border bg-surface2 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-text-3">
                <KeyRound className="size-3" strokeWidth={2} />
                Как включить внешнюю LLM
              </div>
              <div className="space-y-1 text-[13px] leading-relaxed text-text-3">
                <p>Задайте переменные окружения на сервере — гейтвей сам переключится:</p>
                <div className="num rounded bg-bg px-2 py-1.5 text-[13px] leading-relaxed text-text-2">
                  NVIDIA_API_KEY=nvapi-… <span className="text-text-3"># NIM, OpenAI-совместимый</span>
                  <br />
                  LLM_MODEL=meta/llama-3.3-70b-instruct
                  <br />
                  <span className="text-text-3"># или любой совместимый шлюз (OpenRouter, g4f-proxy, opencode):</span>
                  <br />
                  LLM_BASE_URL=https://… LLM_API_KEY=…
                </div>
                <p>Без ключа работает автономный движок на правилах — разборы остаются предметными.</p>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Row 2: prompt catalog ── */}
      <Panel
        title="Каталог изолированных промптов"
        sub="семь точечных анализов, каждый закрывает одну исследовательскую задачу"
        pad={false}
      >
        <div className="grid gap-px bg-border md:grid-cols-2 2xl:grid-cols-4 [&>*]:bg-surface">
          {(d?.promptCatalog ?? []).map((p) => (
            <div key={p.key} className="hoverable group flex flex-col gap-2 p-3.5 hover:bg-surface2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ScanSearch className="size-4 text-text-3 group-hover:text-accent" strokeWidth={1.8} />
                  <h3 className="text-[14px] font-semibold text-text-1">{p.title}</h3>
                </div>
                <button
                  onClick={() => dock.open(p.key, p.title)}
                  disabled={false}
                  aria-label={`Запустить: ${p.title}`}
                  className="hoverable pressable flex size-7 shrink-0 items-center justify-center rounded-md border border-[rgba(91,141,238,0.4)] bg-accent-dim text-accent hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyKind === p.key ? (
                    <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                  ) : (
                    <Play className="size-3" fill="currentColor" strokeWidth={0} />
                  )}
                </button>
              </div>
              <p className="text-[13px] leading-relaxed text-text-3">{p.descRu}</p>
            </div>
          ))}
          {/* Методическая карточка */}
          <div className="flex flex-col gap-2 p-3.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4" style={{ color: "var(--green)" }} strokeWidth={1.8} />
              <h3 className="text-[14px] font-semibold text-text-1">Гарантии конвейера</h3>
            </div>
            <p className="text-[13px] leading-relaxed text-text-3">
              Никаких выдуманных чисел: контекст — только реальные строки PostgreSQL. Каждый разбор пишется в журнал
              с указанием движка и модели, падение LLM автоматически деградирует в glassbox без потери ответа.
            </p>
          </div>
        </div>
      </Panel>

      {/* ── Row 3: feed ── */}
      <Panel
        title="Журнал анализов"
        sub={`${feed.length} последних разборов · каждый воспроизводим из контекста БД`}
        actions={<Bot className="size-3.5 text-text-3" strokeWidth={1.8} />}
      >
        {ai.loading && !d ? (
          <SkeletonRows rows={4} height={64} />
        ) : feed.length === 0 ? (
          <EmptyState
            icon={<CircleDot className="size-4.5" strokeWidth={1.6} />}
            title="Журнал пуст"
            text="Запустите любой анализ из каталога — он сохранится здесь с меткой движка, модели и времени, формируя исследовательскую память лаборатории."
          />
        ) : (
          <div className="stagger grid gap-3 lg:grid-cols-2">
            {feed.map((a) => (
              <AnalysisCard key={a.id} a={a} fresh={freshRuns.some((f) => f.id === a.id)} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}


function AiButtonLocal({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="hoverable pressable flex items-center gap-1.5 rounded-md border border-[rgba(91,141,238,0.45)] bg-accent-dim px-2.5 py-1.5 text-[12.5px] font-semibold text-accent hover:bg-accent hover:text-white"
    >
      <Sparkles className="size-3.5" strokeWidth={2} />
      Открыть диалог
    </button>
  );
}
