"use client";

import React from "react";
import { CheckCircle2, FlaskConical, ShieldCheck, XCircle } from "lucide-react";
import type { ApiState } from "../data";
import { AiButton } from "../ai-dock";
import type { WalkForwardMetrics, WalkForwardResponse } from "@/lib/ui-types";
import { fmtBps, fmtPct } from "@/lib/format";
import { EmptyState, ErrorState, MeterBar, Panel, Pill, SkeletonRows, Tip, TipRow,
  ViewGuide,
} from "../ui";

function WindowCard({ label, sub, m, tone }: { label: string; sub: string; m: WalkForwardMetrics; tone: string }) {
  return (
    <div className="flex flex-col gap-2 panel-lift rounded-[10px] border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[15px] font-semibold text-text-1">{label}</div>
          <div className="text-[13px] text-text-3">{sub}</div>
        </div>
        <span className="num rounded border border-border bg-surface2 px-1.5 py-0.5 text-[13px] text-text-2">n={m.sampleSize}</span>
      </div>
      <div className="num text-[34px] font-semibold leading-none tracking-tight" style={{ color: tone }}>
        {m.hitRate.toFixed(1)}%
      </div>
      <MeterBar value={m.hitRate} max={100} height={4} tone={m.hitRate >= 55 ? "bull" : m.hitRate >= 50 ? "warn" : "bear"} />
      <div className="grid grid-cols-3 gap-2 pt-1">
        <div>
          <div className="text-[13px] uppercase tracking-wider text-text-3">Net bps</div>
          <div className="num text-[14px] font-medium" style={{ color: m.avgReturnNetBps >= 0 ? "var(--green)" : "var(--red)" }}>
            {fmtBps(m.avgReturnNetBps)}
          </div>
        </div>
        <div>
          <div className="text-[13px] uppercase tracking-wider text-text-3">MFE / MAE</div>
          <div className="num text-[14px] text-text-2">{m.avgMfePct.toFixed(2)} / {m.avgMaePct.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[13px] uppercase tracking-wider text-text-3">Profit F.</div>
          <div className="num text-[14px] text-text-2">{m.profitFactor.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}

export function WalkForwardView({ wf }: { wf: ApiState<WalkForwardResponse> }) {
  const d = wf.data;

  if (wf.loading && !d) {
    return (
      <div className="mx-auto max-w-[1920px] p-5">
        <SkeletonRows rows={6} height={60} />
      </div>
    );
  }
  if (wf.error && !d) {
    return (
      <div className="mx-auto max-w-[1920px] p-5">
        <ErrorState message={wf.error} onRetry={() => void wf.refresh()} />
      </div>
    );
  }
  if (!d || !d.windows || !d.split || !d.verdict) {
    return (
      <div className="mx-auto max-w-[1920px] p-5">
        <EmptyState
          icon={<FlaskConical className="size-5" strokeWidth={1.6} />}
          title="Недостаточно выборки для walk-forward"
          text={d?.message ?? "Нужно минимум 6 разрешённых прогнозов. Запустите несколько циклов — тест появится автоматически."}
        />
      </div>
    );
  }

  const { split, windows, verdict } = d;
  const total = split.totalSamples || 1;
  const robust = verdict.isHoldoutRobust;

  return (
    <div className="mx-auto grid max-w-[1920px] gap-4 p-5 anim-fade-up">
      <ViewGuide
        right={<AiButton scope="walkforward_judge" title="Судья честного теста" label="Вынести вердикт" />}
        note="ИИ сравнит окна и скажет: устойчивость это или подгонка под прошлое."
        accent="Честный тест · анти-подгонка"
        steps={[
          { t: "История режется на 3 окна", d: "обучение → проверка → неприкосновенный холдаут, без заглядывания в будущее" },
          { t: "Главное — колонка Holdout", d: "хороший результат там значит: стратегия НЕ подогнана под прошлое" },
          { t: "Сверьте с бенчмарками", d: "модель обязана обыгрывать momentum и buy&hold уже после издержек" },
        ]}
      />

      {/* Verdict banner — функциональный, не декоративный */}
      <div
        className="flex items-center justify-between rounded-[10px] border px-4 py-3"
        style={{
          borderColor: robust ? "rgba(34,211,160,0.3)" : "rgba(251,191,36,0.3)",
          background: robust ? "rgba(34,211,160,0.06)" : "rgba(251,191,36,0.06)",
        }}
      >
        <div className="flex items-center gap-3">
          {robust ? (
            <CheckCircle2 className="size-5 text-bull" strokeWidth={2} />
          ) : (
            <XCircle className="size-5 text-warn" strokeWidth={2} />
          )}
          <div>
            <div className="text-[15px] font-semibold text-text-1">
              {robust ? "Стратегия робастна out-of-sample" : "Робастность не подтверждена"}
            </div>
            <div className="text-[13px] text-text-3">
              Holdout hit-rate {windows.strictlyHoldout.hitRate.toFixed(1)}% · стабильность {verdict.stabilityScore.toFixed(0)}% ·{" "}
              альфа над momentum {fmtBps(verdict.alphaOverMomentumBps)}
            </div>
          </div>
        </div>
        <Pill tone={robust ? "bull" : "warn"} dot>
          {robust ? "DEPLOY-READY" : "RESEARCH ONLY"}
        </Pill>
      </div>

      {/* Chronological split visualization */}
      <Panel title="Хронологический сплит" sub="строгий хронологический порядок: модель никогда не видит будущее — защита от lookahead bias">
        <div className="flex h-7 w-full gap-1 overflow-hidden rounded-md">
          {[
            { n: split.trainSamples, c: "var(--blue)", l: "TRAIN" },
            { n: split.validationSamples, c: "var(--accent)", l: "OOS" },
            { n: split.holdoutSamples, c: robust ? "var(--green)" : "var(--amber)", l: "HOLDOUT" },
          ].map((s) => (
            <Tip key={s.l} label={<TipRow k={s.l} v={`${s.n} прогнозов`} />}>
              <div
                className="hoverable flex h-full cursor-help items-center justify-center text-[13px] font-bold tracking-widest text-bg"
                style={{ width: `${(s.n / total) * 100}%`, background: s.c, opacity: 0.85 }}
              >
                {s.l}
              </div>
            </Tip>
          ))}
        </div>
      </Panel>

      {/* Windows */}
      <div className="grid gap-3 md:grid-cols-3">
        <WindowCard label="In-Sample Train" sub="первые 50% истории" m={windows.inSampleTrain} tone="var(--blue)" />
        <WindowCard label="Out-of-Sample" sub="следующие 25%" m={windows.outOfSampleValidation} tone="var(--accent)" />
        <WindowCard label="Strict Holdout" sub="последние 25% — неприкасаемые" m={windows.strictlyHoldout} tone={robust ? "var(--green)" : "var(--amber)"} />
      </div>

      {/* Baselines */}
      <Panel title="Сравнение с бенчмарками" sub="все цифры — после вычета комиссий, проскальзывания и фандинга: честное сравнение с пассивными стратегиями">
        <div className="stagger space-y-1">
          {Object.values(d.baselines ?? {}).map((b) => {
            const isOurs = b.name.includes("Confluence");
            return (
              <div
                key={b.name}
                className={`grid grid-cols-[1fr_110px_110px_110px] items-center gap-2 rounded-md px-2 py-2 ${
                  isOurs ? "border border-[rgba(91,141,238,0.35)] bg-[rgba(91,141,238,0.05)]" : "hover:bg-surface2"
                }`}
              >
                <div className="min-w-0">
                  <div className={`truncate text-[14px] ${isOurs ? "font-semibold text-text-1" : "text-text-2"}`}>{b.name}</div>
                  <div className="truncate text-[13px] text-text-3">{b.description}</div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] uppercase tracking-wider text-text-3">Hit rate</div>
                  <div className="num text-[14px] font-semibold" style={{ color: b.hitRate >= 55 ? "var(--green)" : b.hitRate >= 50 ? "var(--amber)" : "var(--red)" }}>
                    {b.hitRate.toFixed(1)}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] uppercase tracking-wider text-text-3">Net return</div>
                  <div className="num text-[14px] font-semibold" style={{ color: b.netReturnBps >= 0 ? "var(--green)" : "var(--red)" }}>
                    {fmtBps(b.netReturnBps)}
                  </div>
                </div>
                <div className="pr-1">
                  <MeterBar value={Math.max(0, b.hitRate)} max={100} height={4} tone={b.hitRate >= 55 ? "bull" : b.hitRate >= 50 ? "warn" : "bear"} />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Leakage audit */}
      <div className="flex items-start gap-2.5 panel-lift rounded-[10px] border border-border bg-surface px-4 py-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" style={{ color: "var(--green)" }} strokeWidth={1.8} />
        <p className="text-[14px] leading-relaxed text-text-3">
          <span className="font-medium text-text-2">Leakage-аудит:</span> {verdict.leakageAudit} Оценивание по строго
          хронологическому порядку, без тасования; все метрики — net после round-trip издержек (комиссия + проскальзывание + фандинг).
        </p>
      </div>
    </div>
  );
}
