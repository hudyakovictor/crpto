"use client";

import React from "react";
import { Activity, Crosshair, Wrench, Gauge, LineChart, ShieldAlert, Sigma, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import type { ApiState } from "../data";
import { AiButton } from "../ai-dock";
import type { EdgeResponse, StrategyLeaderRow } from "@/lib/ui-types";
import { fmtPct, fmtUsd, timeAgo } from "@/lib/format";
import { Delta, EmptyState, ErrorState, MeterBar, Panel, Pill, SkeletonRows, Tip, TipRow,
  ViewGuide,
} from "../ui";
import { EquityCurve } from "../charts";

const LEADER_STATUS: Record<StrategyLeaderRow["status"], { tone: "bull" | "accent" | "warn" | "bear"; label: string; hint: string }> = {
  validated: { tone: "bull", label: "РАБОЧАЯ", hint: "Wilson LB ≥ 55%, n ≥ 8, expectancy > 0 — кандидат на реальный деплой" },
  promising: { tone: "accent", label: "ПЕРСПЕКТ.", hint: "Есть edge, но выборки мало — продолжать наблюдение" },
  testing: { tone: "warn", label: "ТЕСТ", hint: "Статистически не доказана — не увеличивать риск" },
  invalid: { tone: "bear", label: "ОТКЛОНЕНА", hint: "Ожидание ≤ 0 или LB < 42% — исключить из портфеля" },
};

function GoalHero({ edge }: { edge: EdgeResponse }) {
  const e = edge.equity;
  const pct = Math.max(0, Math.min(100, e.goalProgressPct));
  const milestones = [25, 50, 75];
  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-text-3">
            Кумулятивный PnL · paper-trading
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span
              className="num text-[42px] font-bold leading-none tracking-tight"
              style={{ color: e.totalPnlUsd >= 0 ? "var(--green)" : "var(--red)" }}
            >
              {fmtUsd(e.totalPnlUsd)}
            </span>
            <span className="num text-[14px] text-text-3">
              {e.tradesCount} сделок × {fmtUsd(edge.capital.notionalPerTradeUsd, false)}
            </span>
          </div>
        </div>
        <Pill tone={e.totalPnlUsd >= 0 ? "bull" : "bear"}>
          {fmtUsd(e.expectancyUsd)} / сделка
        </Pill>
      </div>

      {/* Goal progress */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[13px] text-text-3">
            Прогресс к цели <span className="num text-text-1">{fmtUsd(edge.capital.goalUsd, false)}</span>
          </span>
          <span className="num text-[15px] font-semibold" style={{ color: pct >= 50 ? "var(--green)" : "var(--accent)" }}>
            {pct.toFixed(1)}%
          </span>
        </div>
        <div className="relative h-2.5 overflow-visible rounded-full bg-[rgba(255,255,255,0.06)]">
          <div
            className="h-full rounded-full transition-[width] duration-150"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, var(--accent), var(--green))",
            }}
          />
          {milestones.map((m) => (
            <Tip key={m} label={<TipRow k={`Милстоун ${m}%`} v={fmtUsd((edge.capital.goalUsd * m) / 100, false)} />}>
              <span
                className="absolute -top-[3px] h-4 w-px cursor-help bg-[rgba(255,255,255,0.22)]"
                style={{ left: `${m}%` }}
              />
            </Tip>
          ))}
        </div>
        <div className="num mt-1 flex justify-between text-[13px] text-text-3">
          <span>$0</span>
          <span>{milestones.map((m) => fmtUsd((edge.capital.goalUsd * m) / 100, false)).join(" · ")}</span>
          <span>{fmtUsd(edge.capital.goalUsd, false)}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 border-t border-border pt-3">
        {[
          { k: "Profit Factor", v: e.profitFactor.toFixed(2), tone: e.profitFactor >= 1.4 ? "var(--green)" : e.profitFactor >= 1 ? "var(--amber)" : "var(--red)", icon: Sigma, tip: "Gross win / gross loss. Деплой от 1.4" },
          { k: "Win rate", v: fmtPct(e.winRate, 1, false), tone: e.winRate >= 55 ? "var(--green)" : "var(--text-2)", icon: Trophy, tip: "Доля hits среди решённых" },
          { k: "Ср. выигрыш", v: fmtUsd(e.avgWinUsd), tone: "var(--green)", icon: TrendingUp, tip: "Средний PnL удачной сделки" },
          { k: "Макс. просадка", v: fmtUsd(e.maxDrawdownUsd), tone: "var(--red)", icon: TrendingDown, tip: "Пик-то-дно по кумулятивному PnL" },
        ].map((s) => (
          <Tip key={s.k} label={<span className="text-[13px]">{s.tip}</span>}>
            <div className="cursor-help rounded-md border border-border bg-surface2 px-2.5 py-2">
              <div className="flex items-center gap-1 text-[13px] uppercase tracking-wider text-text-3">
                <s.icon className="size-3" strokeWidth={2} />
                {s.k}
              </div>
              <div className="num mt-1 text-[15px] font-semibold" style={{ color: s.tone }}>{s.v}</div>
            </div>
          </Tip>
        ))}
      </div>
    </div>
  );
}

function RegimeMatrix({ edge }: { edge: EdgeResponse }) {
  const max = Math.max(...edge.regimeMatrix.map((r) => r.hitRate), 1);
  return (
    <div className="stagger flex h-full flex-col gap-[7px]">
      {edge.regimeMatrix.map((r) => {
        const strong = r.hitRate >= 55 && r.n >= 10;
        const weak = r.hitRate < 50 && r.n >= 10;
        return (
          <Tip
            key={r.regime}
            align="start"
            label={
              <div>
                <div className="mb-1 text-[13px] font-semibold text-text-1">{r.labelRu}</div>
                <TipRow k="Наблюдений" v={String(r.n)} />
                <TipRow k="Hits" v={String(r.hits)} />
                <TipRow k="Hit rate" v={fmtPct(r.hitRate, 1, false)} />
                <div className="mt-1 text-[13px] text-text-3">
                  {strong ? "Торговать здесь агрессивно" : weak ? "Здесь edge отсутствует — пропускать" : "Мало данных для вывода"}
                </div>
              </div>
            }
          >
            <div className="hoverable flex cursor-default items-center gap-2 rounded-md px-1 py-[9px] hover:bg-surface2">
              <span className="w-[150px] truncate text-[13px] text-text-2">{r.labelRu}</span>
              <div className="h-[16px] flex-1 overflow-hidden rounded-[4px] bg-[rgba(255,255,255,0.04)]">
                <div
                  className="flex h-full items-center justify-end rounded-[4px] pr-1"
                  style={{
                    width: `${max > 0 ? (r.hitRate / max) * 100 : 0}%`,
                    background: strong ? "rgba(34,211,160,0.5)" : weak ? "rgba(245,101,101,0.45)" : "rgba(96,165,250,0.35)",
                  }}
                />
              </div>
              <span className="num w-12 text-right text-[14px] font-semibold" style={{ color: strong ? "var(--green)" : weak ? "var(--red)" : "var(--text-2)" }}>
                {r.n > 0 ? fmtPct(r.hitRate, 0, false) : "—"}
              </span>
              <span className="num w-10 text-right text-[13px] text-text-3">n={r.n}</span>
            </div>
          </Tip>
        );
      })}
    </div>
  );
}

function Leaderboard({ edge }: { edge: EdgeResponse }) {
  if (edge.leaderboard.length === 0)
    return (
      <EmptyState
        icon={<Trophy className="size-4.5" strokeWidth={1.6} />}
        title="Методики ещё не ранжированы"
        text="Лидерборд строится по разрешённым прогнозам: hit-rate, Wilson lower bound, expectancy после издержек и profit factor."
      />
    );
  return (
    <div className="overflow-x-auto">
    <div className="max-h-[420px] min-w-[860px] overflow-y-auto">
      <div className="grid grid-cols-[28px_1fr_64px_92px_130px_96px_90px_110px] items-center gap-2 border-b border-border px-3 py-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-text-3">
        <span>#</span><span>Методика (сигнатура категорий)</span><span>Дир.</span><span className="text-right">n · HR</span>
        <span>Wilson LB · значимость</span><span className="text-right">Expectancy</span><span className="text-right">PnL</span><span className="text-right">Вердикт</span>
      </div>
      <div className="stagger p-1">
        {edge.leaderboard.map((s, i) => {
          const st = LEADER_STATUS[s.status];
          return (
            <Tip
              key={s.key}
              align="start"
              label={
                <div className="min-w-[230px]">
                  <div className="mb-1 text-[13px] font-semibold text-text-1">{s.labelRu || s.key}</div>
                  <TipRow k="Hits / Misses" v={`${s.hits} / ${s.misses}`} />
                  <TipRow k="Wilson LB (95%)" v={fmtPct(s.wilsonLb * 100, 1, false)} />
                  <TipRow k="Avg MFE / MAE" v={`${s.avgMfe.toFixed(2)}% / ${s.avgMae.toFixed(2)}%`} />
                  <TipRow k="Profit factor" v={s.profitFactor.toFixed(2)} />
                  <TipRow k="Последний сигнал" v={timeAgo(s.lastSeen)} />
                  <div className="mt-1.5 border-t border-border pt-1 text-[13px] leading-snug text-text-3">{st.hint}</div>
                </div>
              }
            >
              <div
                className={`hoverable grid cursor-default grid-cols-[28px_1fr_64px_92px_130px_96px_90px_110px] items-center gap-2 rounded-md px-2 py-[11px] hover:bg-surface2 ${
                  s.status === "validated" ? "bg-[rgba(34,211,160,0.05)]" : ""
                }`}
              >
                <span className={`num text-[13px] ${i < 3 ? "font-bold text-accent" : "text-text-3"}`}>{i + 1}</span>
                <span className="truncate text-[13px] text-text-1">{s.labelRu || s.key}</span>
                <Pill tone={s.direction === "UP" ? "bull" : s.direction === "DOWN" ? "bear" : "info"} className="w-[56px] justify-center">{s.direction}</Pill>
                <span className="num text-right text-[13px] text-text-2">
                  {s.n} · <span style={{ color: s.hitRate >= 55 ? "var(--green)" : s.hitRate < 45 ? "var(--red)" : "var(--text-2)" }}>{s.hitRate.toFixed(0)}%</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <MeterBar value={s.wilsonLb * 100} max={100} height={4} tone={s.wilsonLb >= 0.55 ? "bull" : s.wilsonLb >= 0.45 ? "warn" : "bear"} className="flex-1" />
                  <span className="num w-9 text-right text-[13px] text-text-1">{(s.wilsonLb * 100).toFixed(0)}%</span>
                </span>
                <span className="num text-right text-[13px]" style={{ color: s.expectancyBps > 0 ? "var(--green)" : "var(--red)" }}>
                  {s.expectancyBps > 0 ? "+" : ""}{s.expectancyBps.toFixed(0)} bps
                </span>
                <span className="num text-right text-[14px] font-semibold" style={{ color: s.totalPnlUsd >= 0 ? "var(--green)" : "var(--red)" }}>
                  {fmtUsd(s.totalPnlUsd)}
                </span>
                <span className="flex justify-end"><Pill tone={st.tone} dot={s.status === "validated"} className="w-[96px] justify-center">{st.label}</Pill></span>
              </div>
            </Tip>
          );
        })}
      </div>
    </div>
    </div>
  );
}

export function EdgeView({ edge }: { edge: ApiState<EdgeResponse> }) {
  const d = edge.data;

  if (edge.loading && !d) {
    return (
      <div className="mx-auto grid max-w-[1920px] gap-4 p-5">
        <SkeletonRows rows={3} height={90} />
        <SkeletonRows rows={5} height={40} />
      </div>
    );
  }
  if (edge.error && !d) {
    return (
      <div className="mx-auto max-w-[1920px] p-5">
        <ErrorState message={edge.error} onRetry={() => void edge.refresh()} />
      </div>
    );
  }
  if (!d) return null;

  const decayBad = d.rolling.delta <= -8 && d.rolling.previousHitRate > 0;

  return (
    <div className="mx-auto grid max-w-[1920px] gap-4 p-5 anim-fade-up">
      <ViewGuide
        right={
          <div className="flex gap-2">
            <AiButton scope="edge_critic" title="Критик edge" label="Что масштабировать?" />
            <AiButton scope="capital_planner" title="План до $15 000" label="План до цели" />
          </div>
        }
        note="Каждая панель ниже имеет свою кнопку ИИ: она получает только данные этой панели и возвращает применимые параметры."
        accent="Edge Lab · путь к $15 000"
        steps={[
          { t: "Верх — деньги", d: "кривая из реальных исходов × $5 000 на сигнал; прогресс до цели $15 000" },
          { t: "Лидерборд — что реально работает", d: "РАБОЧАЯ = n ≥ 8 и Wilson LB ≥ 55%: только ей можно доверять объём" },
          { t: "Низ — ускорители", d: "lift категорий, автопорог EVS и воронка — где именно теряется прибыль" },
        ]}
      />

      {/* Row 1 — Goal hero + decay monitor */}
      <div className="grid gap-3 lg:grid-cols-12">
        <Panel title="Трек к цели" sub="net PnL после издержек · симуляция исполнения" className="lg:col-span-8">
          <GoalHero edge={d} />
        </Panel>
        <Panel title="Монитор затухания edge" sub={`скользящее окно ${d.rolling.windowSize} сделок`} className="lg:col-span-4" actions={<AiButton scope="risk_gate" title="Pre-trade чек-лист" compact />}>
          <div className="flex h-full flex-col justify-between gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border bg-surface2 p-3">
                <div className="text-[13px] uppercase tracking-wider text-text-3">Текущее окно</div>
                <div className="num mt-1 text-[30px] font-bold leading-none" style={{ color: d.rolling.recentHitRate >= 55 ? "var(--green)" : "var(--text-1)" }}>
                  {d.rolling.recentHitRate.toFixed(0)}%
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface2 p-3">
                <div className="text-[13px] uppercase tracking-wider text-text-3">Пред. окно</div>
                <div className="num mt-1 text-[30px] font-bold leading-none text-text-3">
                  {d.rolling.previousHitRate > 0 ? `${d.rolling.previousHitRate.toFixed(0)}%` : "—"}
                </div>
              </div>
            </div>
            <div
              className="flex items-center justify-between rounded-md border px-3 py-2.5"
              style={{
                borderColor: decayBad ? "rgba(245,101,101,0.3)" : "rgba(34,211,160,0.25)",
                background: decayBad ? "rgba(245,101,101,0.07)" : "rgba(34,211,160,0.06)",
              }}
            >
              <div>
                <div className="text-[14px] font-semibold" style={{ color: decayBad ? "var(--red)" : "var(--green)" }}>
                  {decayBad ? "Edge затухает — снизить риск" : "Edge стабилен"}
                </div>
                <div className="text-[13px] text-text-3">
                  {decayBad ? "Пересмотреть пороги EVS и режимные фильтры" : "Можно сохранять текущий риск-профиль"}
                </div>
              </div>
              <Delta value={d.rolling.delta} digits={1} suffix=" п.п." className="text-[15px]" />
            </div>
            <div className="rounded-md border border-border bg-surface2 px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5 text-[13px] uppercase tracking-wider text-text-3">
                <Gauge className="size-3" strokeWidth={2} /> Правило деплоя
              </div>
              <p className="text-[13px] leading-relaxed text-text-3">
                Увеличивать риск только для методик <span style={{ color: "var(--green)" }}>РАБОЧАЯ</span> в их
                профильных режимах (матрица ниже). Остальное — paper-size.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      {/* Row 2 — Equity curve + regime matrix */}
      <div className="grid gap-3 lg:grid-cols-12">
        <Panel
          title="Кривая капитала"
          sub={`${fmtUsd(d.capital.notionalPerTradeUsd, false)} notional на сигнал · просадка подсвечена`}
          className="lg:col-span-7"
          actions={<LineChart className="size-3.5 text-text-3" strokeWidth={1.8} />}
        >
          {d.equity.points.length > 1 ? (
            <EquityCurve points={d.equity.points} goalUsd={d.capital.goalUsd} height={218} />
          ) : (
            <EmptyState
              icon={<Activity className="size-4.5" strokeWidth={1.6} />}
              title="Кривая ещё не построена"
              text="Нужно минимум 2 решённых прогноза. Запустите цикл — каждый resolved прогноз добавляет точку."
            />
          )}
        </Panel>
        <Panel title="Режимная матрица" sub="hit-rate по рыночным режимам" className="lg:col-span-5" actions={<AiButton scope="regime_playbook" title="Плейбук режима" compact />}>
          <RegimeMatrix edge={d} />
        </Panel>
      </div>

      {/* Row 3 — Leaderboard + error taxonomy */}
      <div className="grid gap-3 lg:grid-cols-12">
        <Panel
          title="Лидерборд методик"
          sub="ранжировано по Wilson LB × √n — статистика вместо интуиции"
          className="lg:col-span-8"
          pad={false}
          actions={<AiButton scope="edge_critic" title="Критик edge" compact />}
        >
          <Leaderboard edge={d} />
        </Panel>
        <Panel
          title="Где теряются деньги"
          sub="таксономия ошибок + фикс"
          className="lg:col-span-4"
          actions={<AiButton scope="ledger_postmortem" title="Разбор промахов" compact />}
        >
          {d.errors.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="size-4.5" strokeWidth={1.6} />}
              title="Losses не классифицированы"
              text="Первые промахи будут автоматически размечены по типу: слабый сигнал, неверный знак, горизонт, режим, издержки."
            />
          ) : (
            <div className="stagger space-y-2.5">
              {d.errors.slice(0, 6).map((e) => (
                <div key={e.type}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-text-1">{e.labelRu}</span>
                    <span className="num text-[13px] text-text-3">{e.count} · {e.sharePct.toFixed(0)}%</span>
                  </div>
                  <div className="h-[5px] overflow-hidden rounded-full bg-[rgba(255,255,255,0.05)]">
                    <div className="h-full rounded-full" style={{ width: `${e.sharePct}%`, background: "var(--red)", opacity: 0.7 }} />
                  </div>
                  <div className="mt-1 flex items-start gap-1 text-[13px] leading-snug text-text-3">
                    <Wrench className="mt-px size-3 shrink-0" strokeWidth={2} />
                    {e.fixRu}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Row 4 — ускорители анализа: вклад категорий, автопорог, воронка */}
      <div className="grid gap-3 lg:grid-cols-12">
        {/* Вклад каждой категории в реальный edge */}
        <Panel
          title="Вклад категорий в edge"
          sub="hit-rate сделок С категорией минус БЕЗ неё — lift-анализ на реальных исходах"
          className="lg:col-span-5"
          actions={<AiButton scope="category_pruner" title="Чистка категорий" compact />}
        >
          {!d.categoryContribution || d.categoryContribution.length === 0 ? (
            <EmptyState
              icon={<Activity className="size-4.5" strokeWidth={1.6} />}
              title="Мало данных для lift-анализа"
              text="Нужно минимум 2 сделки с участием категории. Метрика сравнивает точность прогнозов, где категория присутствовала, с точностью прогнозов без неё."
            />
          ) : (
            <div className="stagger space-y-[7px]">
              {d.categoryContribution.slice(0, 8).map((c) => {
                const maxAbs = 40;
                const pct = Math.min(100, (Math.abs(c.lift) / maxAbs) * 100);
                const good = c.lift > 2;
                const bad = c.lift < -2;
                return (
                  <Tip
                    key={c.category}
                    align="start"
                    label={
                      <div>
                        <div className="mb-1 text-[13px] font-semibold text-text-1">{c.labelRu}</div>
                        <TipRow k="HR с категорией" v={`${c.hrWith.toFixed(1)}% (n=${c.nWith})`} />
                        <TipRow k="HR без неё" v={`${c.hrWithout.toFixed(1)}% (n=${c.nWithout})`} />
                        <TipRow k="Lift" v={`${c.lift > 0 ? "+" : ""}${c.lift.toFixed(1)} п.п.`} tone={good ? "bull" : bad ? "bear" : "neutral"} />
                        <div className="mt-1 text-[13px] text-text-3">
                          {good ? "Усиливает сигнал — сохранять в комбинациях" : bad ? "Размывает сигнал — кандидат на исключение" : "Нейтральна — не влияет статистически"}
                        </div>
                      </div>
                    }
                  >
                    <div className="hoverable flex cursor-default items-center gap-2 rounded px-1 py-[7px] hover:bg-surface2">
                      <span className="w-[150px] truncate text-[13px] text-text-2">{c.labelRu}</span>
                      <div className="relative flex h-[14px] flex-1 items-center">
                        <span className="absolute left-1/2 h-full w-px bg-[rgba(255,255,255,0.14)]" />
                        <span
                          className="absolute h-[5px] rounded-full"
                          style={{
                            left: c.lift >= 0 ? "50%" : `calc(50% - ${pct / 2}%)`,
                            width: `${pct / 2}%`,
                            background: good ? "var(--green)" : bad ? "var(--red)" : "var(--blue)",
                          }}
                        />
                      </div>
                      <span className="num w-14 text-right text-[13px] font-semibold" style={{ color: good ? "var(--green)" : bad ? "var(--red)" : "var(--text-2)" }}>
                        {c.lift > 0 ? "+" : ""}{c.lift.toFixed(1)}
                      </span>
                      <span className="num w-9 text-right text-[13px] text-text-3">n={c.nWith}</span>
                    </div>
                  </Tip>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Автокалибровка порога EVS */}
        <Panel
          title="Автокалибровка порога EVS"
          sub={d.bestCutoff ? `рекомендация: брать сигналы от EVS ≥ ${d.bestCutoff}` : "какая отсечка максимизирует expectancy"}
          className="lg:col-span-4"
          actions={<AiButton scope="filter_tuner" title="Настройщик фильтров" compact />}
        >
          {!d.thresholdAdvisor || d.thresholdAdvisor.every((t) => t.n === 0) ? (
            <EmptyState
              icon={<Activity className="size-4.5" strokeWidth={1.6} />}
              title="Порог не вычислен"
              text="Адвизор прогоняет сетку отсечек 45–80 по истории и выбирает ту, что дала максимальный expectancy после издержек."
            />
          ) : (
            <div className="stagger space-y-1">
              {d.thresholdAdvisor.map((t) => {
                const best = t.cutoff === d.bestCutoff;
                return (
                  <div
                    key={t.cutoff}
                    className={`grid grid-cols-[64px_1fr_58px_70px] items-center gap-2 rounded-md px-2 py-[9px] ${
                      best ? "border border-[rgba(34,211,160,0.35)] bg-[rgba(34,211,160,0.06)]" : "hover:bg-surface2"
                    }`}
                  >
                    <span className={`num text-[13px] font-semibold ${best ? "text-bull" : "text-text-2"}`}>
                      ≥ {t.cutoff}
                    </span>
                    <MeterBar value={t.n} max={Math.max(1, ...(d.thresholdAdvisor ?? []).map((x) => x.n))} height={4} tone={best ? "bull" : "info"} />
                    <span className="num text-right text-[13px] text-text-3">n={t.n}</span>
                    <span className="num text-right text-[13px]" style={{ color: t.expectancyBps > 0 ? "var(--green)" : "var(--red)" }}>
                      {t.expectancyBps > 0 ? "+" : ""}{t.expectancyBps.toFixed(0)} bps
                    </span>
                  </div>
                );
              })}
              <p className="px-2 pt-2 text-[13px] leading-relaxed text-text-3">
                Подсвеченная строка — отсечка с максимальным expectancy при достаточной выборке (n ≥ 5).
                Применяйте её как фильтр перед оформлением гипотез: это прямо режет сделки с
                отрицательным матожиданием.
              </p>
            </div>
          )}
        </Panel>

        {/* Воронка исследования */}
        <Panel
          title="Воронка исследования"
          sub="где сигналы отмирают на пути к деньгам"
          className="lg:col-span-3"
        >
          {!d.funnel ? (
            <SkeletonRows rows={5} height={30} />
          ) : (
            <div className="stagger flex h-full flex-col justify-between gap-1.5">
              {d.funnel.map((s, i) => {
                const last = i === d.funnel!.length - 1;
                const widthPct = 100 - i * 13;
                return (
                  <Tip
                    key={s.stage}
                    align="start"
                    label={
                      <div>
                        <div className="mb-0.5 text-[13px] font-semibold text-text-1">{s.stage}</div>
                        <div className="text-[13px] text-text-2">{s.note}</div>
                      </div>
                    }
                  >
                    <div className="cursor-default">
                      <div className="mb-1 flex items-baseline justify-between">
                        <span className="text-[13px] text-text-2">{s.stage}</span>
                        <span className="num text-[14px] font-bold" style={{ color: last ? "var(--green)" : "var(--text-1)" }}>
                          {s.count}
                        </span>
                      </div>
                      <div className="h-[6px] rounded-full bg-[rgba(255,255,255,0.05)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(8, widthPct)}%`,
                            background: last ? "var(--green)" : `rgba(91,141,238,${0.85 - i * 0.11})`,
                          }}
                        />
                      </div>
                    </div>
                  </Tip>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* Методологическая сноска */}
      <div className="panel-lift rounded-[10px] border border-border bg-surface px-4 py-3">
        <p className="text-[14px] leading-relaxed text-text-3">
          <span className="font-medium text-text-2">Как этим пользоваться:</span> сначала смотрите «Автокалибровку» —
          она задаёт минимальный EVS для новых сигналов; затем проверяйте, что ведущие категории сигнала имеют
          положительный lift; наконец торгуйте только методики со статусом РАБОЧАЯ в их профильном режиме.
          Такой порядок устраняет подгонку по памяти и конвертирует исследование в воспроизводимый процесс отбора.
        </p>
      </div>
    </div>
  );
}
