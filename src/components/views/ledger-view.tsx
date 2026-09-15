"use client";

import React, { useMemo, useState } from "react";
import { Check, Clock3, FileSearch, History, Minus, ShieldAlert, Target, X } from "lucide-react";
import type { ApiState } from "../data";
import { AiButton } from "../ai-dock";
import type { ForecastRow, LedgerResponse } from "@/lib/ui-types";
import { fmtClock, fmtPct, fmtPrice, timeAgo } from "@/lib/format";
import { EmptyState, ErrorState, Panel, Pill, SkeletonRows, Tip, TipRow,
  ViewGuide,
} from "../ui";

type OutcomeFilter = "all" | "hit" | "miss" | "pending";

function outcomeMeta(f: ForecastRow) {
  const pending = f.status === "pending";
  const o = pending ? "pending" : f.outcome ?? "ambiguous";
  const color =
    o === "hit" ? "var(--green)" : o === "miss" ? "var(--red)" : o === "pending" ? "var(--blue)" : "var(--amber)";
  const Icon = o === "hit" ? Check : o === "miss" ? X : o === "pending" ? Clock3 : Minus;
  const label = o === "hit" ? "HIT" : o === "miss" ? "MISS" : o === "pending" ? "PENDING" : "AMBIG";
  return { o, color, Icon, label, pending };
}

/** Price ladder: invalidation — entry — target with resolved marker. */
function PriceLadder({ f }: { f: ForecastRow }) {
  const hyp = f.hypothesis;
  if (!hyp) return null;
  const lo = Math.min(hyp.invalidationPrice, hyp.targetPrice);
  const hi = Math.max(hyp.invalidationPrice, hyp.targetPrice);
  const span = hi - lo || 1;
  const pos = (v: number) => `${Math.max(2, Math.min(98, ((v - lo) / span) * 100))}%`;
  const resolved = f.resolvedPrice;

  return (
    <div>
      <div className="relative h-9 rounded-md border border-border bg-surface2">
        <div
          className="absolute top-0 h-full rounded-md bg-[rgba(91,141,238,0.10)]"
          style={{ left: pos(Math.min(hyp.entryPrice, hyp.targetPrice)), width: `calc(${pos(Math.max(hyp.entryPrice, hyp.targetPrice))} - ${pos(Math.min(hyp.entryPrice, hyp.targetPrice))})` }}
        />
        {[
          { v: hyp.invalidationPrice, c: "var(--red)", l: "Инвалидация" },
          { v: hyp.entryPrice, c: "var(--text-1)", l: "Вход" },
          { v: hyp.targetPrice, c: "var(--green)", l: "Цель" },
        ].map((m) => (
          <div key={m.l} className="absolute top-1 flex flex-col items-center" style={{ left: pos(m.v), transform: "translateX(-50%)" }}>
            <span className="h-3 w-[2px] rounded" style={{ background: m.c }} />
            <span className="num mt-0.5 text-[13px]" style={{ color: m.c }}>
              {m.l}
            </span>
          </div>
        ))}
        {resolved != null && resolved >= lo && resolved <= hi && (
          <div className="absolute -top-1 size-2.5 rounded-full border-2 border-bg" style={{ left: pos(resolved), transform: "translateX(-50%)", background: "var(--amber)" }} />
        )}
      </div>
      <div className="num mt-1 flex justify-between text-[13px] text-text-3">
        <span>${fmtPrice(lo)}</span>
        <span>${fmtPrice(hi)}</span>
      </div>
    </div>
  );
}

export function LedgerView({ ledger }: { ledger: ApiState<LedgerResponse> }) {
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const items = useMemo(() => {
    const all = ledger.data?.forecasts ?? [];
    return all.filter((f) => {
      if (filter === "all") return true;
      if (filter === "pending") return f.status === "pending";
      return f.outcome === filter;
    });
  }, [ledger.data, filter]);

  const selected = items.find((f) => f.id === selectedId) ?? items[0] ?? null;

  return (
    <div className="mx-auto grid max-w-[1920px] gap-4 p-5 lg:grid-cols-12 anim-fade-up">
      <ViewGuide
        right={<AiButton scope="ledger_postmortem" title="Разбор промахов" label="Разобрать потери" />}
        note="ИИ классифицирует промахи и выдаст правила с числовыми порогами, которые их предотвратят."
        accent="Журнал · честная история"
        steps={[
          { t: "Слева — лента всех прогнозов", d: "зелёная галка — сработал, красный крест — промах, синяя точка — ждёт истечения" },
          { t: "Кликните любую строку", d: "справа откроется досье: лестница цен, формула, механизм и тип ошибки" },
          { t: "MFE/MAE — диагностика", d: "большой MFE при промахе = идея верна, ошибся горизонт — чиним фиксацию" },
        ]}
        className="lg:col-span-12"
      />

      {/* Timeline list */}
      <Panel
        title="Timeline-реестр"
        sub={`${items.length} прогнозов`}
        className="lg:col-span-7"
        pad={false}
        actions={
          <div className="flex items-center gap-1">
            {(
              [
                ["all", "Все"],
                ["hit", "Hits"],
                ["miss", "Misses"],
                ["pending", "Pending"],
              ] as [OutcomeFilter, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`hoverable pressable rounded-md px-2 py-1 text-[13px] font-medium ${
                  filter === k ? "bg-surface3 text-text-1" : "text-text-3 hover:text-text-1"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <div className="relative max-h-[calc(100vh-232px)] min-h-[320px] overflow-y-auto p-3 pl-4">
          {ledger.loading && !ledger.data ? (
            <SkeletonRows rows={10} height={40} />
          ) : ledger.error && !ledger.data ? (
            <ErrorState message={ledger.error} onRetry={() => void ledger.refresh()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<History className="size-4.5" strokeWidth={1.6} />}
              title="Записей нет"
              text="Под текущим фильтром пусто. Запустите цикл — прогнозы появятся здесь с ценой входа, целью и инвалидацией."
            />
          ) : (
            <>
              <div className="absolute bottom-3 left-[26px] top-3 w-px bg-border" />
              <div className="stagger">
                {items.map((f) => {
                  const m = outcomeMeta(f);
                  const isSel = selected?.id === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setSelectedId(f.id)}
                      className={`hoverable relative mb-1 flex w-full items-center gap-3 rounded-lg border px-2 py-2 text-left ${
                        isSel ? "border-[rgba(91,141,238,0.4)] bg-[rgba(91,141,238,0.06)]" : "border-transparent hover:bg-surface2"
                      }`}
                    >
                      <span
                        className={`relative z-[1] flex size-[20px] shrink-0 items-center justify-center rounded-full border ${m.o === "pending" ? "pulse-dot" : ""}`}
                        style={{ borderColor: m.color, background: "var(--surface)", color: m.color }}
                      >
                        <m.Icon className="size-[10px]" strokeWidth={3} />
                      </span>
                      <div className="w-[92px] shrink-0">
                        <div className="num text-[13px] text-text-1">{fmtClock(f.createdAt)}</div>
                        <div className="text-[13px] text-text-3">{timeAgo(f.createdAt)}</div>
                      </div>
                      <span className="num w-[48px] text-[14px] font-semibold text-text-1">{f.asset.replace("-USDT", "")}</span>
                      <Pill tone={f.direction === "UP" ? "bull" : f.direction === "DOWN" ? "bear" : "info"} className="w-[62px] justify-center">
                        {f.direction}
                      </Pill>
                      <span className="num hidden w-[86px] text-[13px] text-text-3 md:inline">${fmtPrice(f.entryPrice)}</span>
                      <span className="min-w-0 flex-1" />
                      <span className="num text-[14px] font-semibold" style={{ color: m.color }}>
                        {m.pending ? `${f.horizonMinutes}м` : f.realizedReturnNet != null ? fmtPct(f.realizedReturnNet, 2) : m.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Panel>

      {/* Detail card */}
      <Panel title="Досье прогноза" sub={selected ? `FCT-${selected.id}` : ""} className="lg:col-span-5">
        {!selected ? (
          <EmptyState
            icon={<FileSearch className="size-4.5" strokeWidth={1.6} />}
            title="Выберите запись"
            text="Кликните по строке таймлайна — здесь появится полный разбор: формула, механизм, MFE/MAE и тип ошибки."
          />
        ) : (
          <div className="stagger space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="num text-[15px] font-semibold text-text-1">
                  {selected.asset} · {selected.direction}
                </div>
                <div className="num text-[13px] text-text-3">FCT-{selected.id} · горизонт {selected.horizonMinutes} мин</div>
              </div>
              <Pill
                tone={outcomeMeta(selected).o === "hit" ? "bull" : outcomeMeta(selected).o === "miss" ? "bear" : outcomeMeta(selected).o === "pending" ? "info" : "warn"}
                dot={outcomeMeta(selected).pending}
              >
                {outcomeMeta(selected).label}
              </Pill>
            </div>

            <PriceLadder f={selected} />

            <div className="grid grid-cols-3 gap-2">
              {[
                { k: "MFE", v: selected.mfe != null ? fmtPct(selected.mfe, 2, false) : "—", tone: "var(--green)", tip: "Макс. благоприятное движение" },
                { k: "MAE", v: selected.mae != null ? fmtPct(selected.mae, 2, false) : "—", tone: "var(--red)", tip: "Макс. неблагоприятное движение" },
                { k: "Net return", v: selected.realizedReturnNet != null ? fmtPct(selected.realizedReturnNet, 2) : "—", tone: (selected.realizedReturnNet ?? 0) >= 0 ? "var(--green)" : "var(--red)", tip: "После комиссий, проскальзывания и фандинга" },
              ].map((c) => (
                <Tip key={c.k} label={<span className="text-[13px]">{c.tip}</span>}>
                  <div className="cursor-help rounded-md border border-border bg-surface2 px-2.5 py-2 text-center">
                    <div className="text-[13px] uppercase tracking-wider text-text-3">{c.k}</div>
                    <div className="num mt-0.5 text-[15px] font-semibold" style={{ color: c.tone }}>{c.v}</div>
                  </div>
                </Tip>
              ))}
            </div>

            {selected.errorType && selected.errorType !== "none" && (
              <div className="flex items-start gap-2 rounded-md border border-[rgba(251,191,36,0.22)] bg-warn-dim px-3 py-2">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warn" strokeWidth={2} />
                <div>
                  <div className="text-[13px] font-medium text-warn">Разбор ошибки: {selected.errorType}</div>
                  <div className="text-[13px] text-text-2">См. Edge Lab → таксономия ошибок для корректирующего действия.</div>
                </div>
              </div>
            )}

            {selected.hypothesis && (
              <div className="space-y-2 rounded-md border border-border bg-surface2 p-3">
                <div className="flex items-center gap-2">
                  <Target className="size-3.5 text-accent" strokeWidth={2} />
                  <span className="num text-[13px] font-semibold text-text-1">{selected.hypothesis.code}</span>
                  <Pill tone="neutral">{selected.hypothesis.status}</Pill>
                </div>
                <p className="text-[13px] leading-relaxed text-text-2">{selected.hypothesis.expectedMechanism}</p>
                <div className="num rounded bg-bg px-2 py-1.5 text-[13px] leading-relaxed text-text-3">
                  {selected.hypothesis.exactFormula}
                </div>
                <TipRow k="Неопределённость" v={fmtPct(selected.hypothesis.uncertainty * 100, 0, false)} />
              </div>
            )}

            {/* Методическая сноска — как читать досье */}
            <div className="rounded-md border border-border bg-surface px-3 py-2.5">
              <p className="text-[13px] leading-relaxed text-text-3">
                <span className="font-medium text-text-2">Как читать досье:</span> ценовая лестница показывает зону
                между инвалидацией и целью; янтарная точка — цена фактического разрешения. MFE — максимальный ход
                в сторону прогноза, MAE — против; большой MFE при промахе означает «правильная идея, неверный
                горизонт» и ведёт к правке плеча фиксации, а не всей модели.
              </p>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
