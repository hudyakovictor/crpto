"use client";

import React, { useMemo, useState } from "react";
import { Inbox, Layers, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ApiState } from "../data";
import { AiButton } from "../ai-dock";
import type { CombinationsResponse } from "@/lib/ui-types";
import { CATEGORY_SHORT } from "@/lib/format";
import { EmptyState, ErrorState, evsTone, MeterBar, Panel, Pill, SkeletonRows, Tip, TipRow,
  ViewGuide,
} from "../ui";

type StatusFilter = "all" | "promising" | "candidate" | "rejected";

function DirIcon({ d }: { d: string }) {
  if (d === "UP") return <TrendingUp className="size-3.5" style={{ color: "var(--green)" }} strokeWidth={2.2} />;
  if (d === "DOWN") return <TrendingDown className="size-3.5" style={{ color: "var(--red)" }} strokeWidth={2.2} />;
  return <Minus className="size-3.5" style={{ color: "var(--blue)" }} strokeWidth={2.2} />;
}

export function CombinationsView({ combos }: { combos: ApiState<CombinationsResponse> }) {
  const [filter, setFilter] = useState<StatusFilter>("all");

  const rows = useMemo(() => {
    const all = combos.data?.combinations ?? [];
    if (filter === "all") return all;
    if (filter === "rejected") return all.filter((c) => c.status === "rejected" || c.earlyValueScore < 45);
    return all.filter((c) => c.status === filter);
  }, [combos.data, filter]);

  const s = combos.data?.stats;

  return (
    <div className="mx-auto grid max-w-[1920px] gap-4 p-5 anim-fade-up">
      <ViewGuide
        right={
          <div className="flex gap-2">
            <AiButton scope="combo_audit" title="Аудит комбинаций" label="Проверить связки" />
            <AiButton scope="hypothesis_writer" title="Автор гипотезы" label="Придумать гипотезу" />
          </div>
        }
        note="ИИ разберёт топ цикла, отбракует дубли категорий и предложит порог отбора — применяется одним кликом."
        accent="Комбинации · цех идей"
        steps={[
          { t: "Это генератор гипотез", d: "каждый цикл движок строит ровно 100 связок из 15 категорий сигналов" },
          { t: "Смотрите колонку EVS", d: "оценка 0–100: ≥ 75 — элита цикла; серая строка — не прошла ваши фильтры (клавиша S)" },
          { t: "Вкладки сверху режут шум", d: "«Promising» — то, что реально может стать торговой методикой" },
        ]}
      />

      <Panel
        title="Комбинаторная разведка"
        sub={
          combos.data
            ? `${combos.data.symbol} · режим ${combos.data.regime.replace(/_/g, " ")} · 100 вариаций за цикл`
            : "100 вариаций за цикл"
        }
        actions={
          s && (
            <div className="flex items-center gap-1.5">
              <Pill tone="accent">{s.promisingCount} promising</Pill>
              <Pill tone="info">{s.candidatesCount} candidates</Pill>
              <Pill tone="neutral">{s.rejectedCount} rejected</Pill>
              <Pill tone="bull">top {s.topScore.toFixed(0)}</Pill>
            </div>
          )
        }
        pad={false}
      >
        {/* Filter rail */}
        <div className="flex h-10 items-center gap-1 border-b border-border px-3">
          {(
            [
              ["all", "Все 100"],
              ["promising", "Promising"],
              ["candidate", "Candidate"],
              ["rejected", "Rejected / слабые"],
            ] as [StatusFilter, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`hoverable pressable rounded-md px-2.5 py-1 text-[13px] font-medium ${
                filter === k ? "bg-surface3 text-text-1" : "text-text-3 hover:text-text-1"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="num ml-auto text-[13px] text-text-3">
            {rows.length} строк{typeof combos.data?.passCount === "number" ? ` · ${combos.data.passCount} проходят фильтр (EVS ≥ ${combos.data.filters?.minEvs})` : ""}
          </span>
        </div>

        <div className="overflow-x-auto">
        <div className="min-w-[980px]">
        {/* Table head */}
        <div className="grid grid-cols-[36px_28px_220px_92px_1fr_190px_110px] items-center gap-2 border-b border-border px-3 py-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-text-3 max-xl:grid-cols-[36px_28px_180px_92px_1fr_170px_100px]">
          <span>#</span>
          <span>Дир.</span>
          <span>Код комбинации</span>
          <span>Оператор</span>
          <span>Категории</span>
          <span>Early Value Score</span>
          <span className="text-right">Статус</span>
        </div>

        <div className="max-h-[calc(100vh-280px)] min-h-[300px] overflow-y-auto">
          {combos.loading && !combos.data ? (
            <SkeletonRows rows={12} height={30} />
          ) : combos.error && !combos.data ? (
            <ErrorState message={combos.error} onRetry={() => void combos.refresh()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-4.5" strokeWidth={1.6} />}
              title="Нет комбинаций под фильтром"
              text="Смените фильтр или запустите новый цикл генерации."
            />
          ) : (
            <div className="stagger">
              {rows.map((c, i) => {
                const evs = c.earlyValueScore;
                return (
                  <Tip
                    key={c.code}
                    align="start"
                    label={
                      <div className="min-w-[240px]">
                        <div className="num mb-0.5 text-[13px] font-semibold text-text-1">{c.code}</div>
                        <div className="mb-1.5 text-[13px] leading-snug text-text-2">{c.expression}</div>
                        <TipRow k="Novelty" v={`${c.breakdown.novelty}/20`} />
                        <TipRow k="Cross-agreement" v={`${c.breakdown.crossAgreement}/20`} />
                        <TipRow k="Historical support" v={`${c.breakdown.historicalSupport}/20`} />
                        <TipRow k="Effect stability" v={`${c.breakdown.effectStability}/15`} />
                        <TipRow k="Liquidity coverage" v={`${c.breakdown.coverageLiquidity}/10`} />
                        <TipRow k="Data quality" v={`${c.breakdown.dataQuality}/10`} />
                        <TipRow k="Testability" v={`${c.breakdown.testability}/5`} />
                        <TipRow k="Lookback / Threshold" v={`${c.parameters.lookback} / ${c.parameters.threshold}`} />
                        <TipRow k="Composite score" v={c.compositeScore.toFixed(3)} />
                      </div>
                    }
                  >
                    <div
                      className={`hoverable grid cursor-default grid-cols-[36px_28px_220px_92px_1fr_190px_110px] items-center gap-2 border-b border-[rgba(255,255,255,0.03)] px-3 py-[11px] hover:bg-surface2 max-xl:grid-cols-[36px_28px_180px_92px_1fr_170px_100px] ${
                        i === 0 && filter === "all" ? "bg-[rgba(91,141,238,0.05)]" : ""
                      } ${c.passes === false ? "opacity-40" : ""}`}
                    >
                      <span className={`num text-[14px] ${i < 3 ? "font-semibold text-accent" : "text-text-3"}`}>{i + 1}</span>
                      <DirIcon d={c.targetDirection} />
                      <span className="num truncate text-[14px] font-medium text-text-1">{c.code}</span>
                      <span className="num w-fit rounded border border-border bg-surface2 px-1.5 py-px text-[13px] text-text-2">
                        {c.operator}
                      </span>
                      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                        {c.categories.map((cat) => (
                          <span key={cat} className="num shrink-0 rounded bg-[rgba(255,255,255,0.045)] px-1 py-[2px] text-[13px] text-text-3">
                            {CATEGORY_SHORT[cat] ?? cat.slice(0, 3).toUpperCase()}
                          </span>
                        ))}
                      </span>
                      <span className="flex items-center gap-2">
                        <MeterBar value={evs} tone={evsTone(evs)} height={4} className="flex-1" />
                        <span className="num w-7 text-right text-[14px] font-semibold text-text-1">{evs.toFixed(0)}</span>
                      </span>
                      <span className="text-right">
                        {c.passes === false ? <Pill tone="neutral" className="w-[96px] justify-center">ВНЕ ФИЛЬТРА</Pill> : <StatusPill status={c.status} />}
                      </span>
                    </div>
                  </Tip>
                );
              })}
            </div>
          )}
        </div>
        </div>
        </div>
      </Panel>

      {/* Methodology note */}
      <div className="flex items-start gap-2.5 panel-lift rounded-[10px] border border-border bg-surface px-4 py-3">
        <Layers className="mt-0.5 size-4 shrink-0 text-text-3" strokeWidth={1.7} />
        <p className="text-[14px] leading-relaxed text-text-3">
          Каждый цикл детерминированно строит <span className="num text-text-2">30 парных</span>,{" "}
          <span className="num text-text-2">40 тройных</span>, <span className="num text-text-2">20 квадро-комбо</span> и{" "}
          <span className="num text-text-2">10 режимных VETO</span> из 15 категорий. EVS — взвешенная сумма 7 факторов:
          новизна, кросс-согласие, историческая поддержка, стабильность эффекта, ликвидность, качество данных и тестируемость.
          Комбинации с EVS ≥ 60 автоматически оформляются в фальсифицируемые гипотезы.
        </p>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: "bull" | "accent" | "info" | "neutral"; label: string }> = {
    validated: { tone: "bull", label: "VALIDATED" },
    promising: { tone: "accent", label: "PROMISING" },
    candidate: { tone: "info", label: "CANDIDATE" },
    rejected: { tone: "neutral", label: "REJECTED" },
  };
  const m = map[status] ?? map.candidate;
  return <Pill tone={m.tone} className="w-[86px] justify-center">{m.label}</Pill>;
}
