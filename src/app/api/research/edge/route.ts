import { NextResponse } from "next/server";
import { db } from "@/db";
import { combinations as combinationsTable, forecasts, hypotheses, learningWeights } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { CATEGORY_DEFINITIONS } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Notional allocated to every forecast in the paper-trading simulation. */
const NOTional_PER_TRADE_USD = 5000;
const GOAL_USD = 15000;
const REGIME_LABELS: Record<string, string> = {
  TRENDING_BULL: "Восходящий тренд",
  TRENDING_BEAR: "Нисходящий тренд",
  HIGH_VOLATILITY_CHOP: "Волатильная пила",
  LOW_VOLATILITY_SQUEEZE: "Сжатие волатильности",
  LIQUIDITY_CRUNCH: "Дефицит ликвидности",
  NEUTRAL_CONSOLIDATION: "Консолидация",
};

/** Wilson score lower bound (z = 1.96 → 95% confidence). Separates luck from edge. */
function wilsonLowerBound(hits: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (centre - margin) / denom;
}

interface HypLite {
  id: number;
  categoriesJson: unknown;
  direction: string;
  scoreComponentsJson?: unknown;
  parametersRegime?: string | null;
  createdAt: Date;
}

export async function GET() {
  try {
    const resolved = await db
      .select()
      .from(forecasts)
      .where(eq(forecasts.status, "resolved"))
      .orderBy(asc(forecasts.createdAt));

    const hypList = await db.select().from(hypotheses).orderBy(asc(hypotheses.createdAt));
    const hypMap = new Map<number, HypLite>(hypList.map((h) => [h.id, h as HypLite]));

    /* ---------------- Equity curve (paper-trading, net of costs) ---------------- */

    const points: {
      t: string;
      pnlUsd: number;
      cumPnlUsd: number;
      outcome: string;
      asset: string;
      retPct: number;
    }[] = [];

    let cum = 0;
    let peak = 0;
    let maxDd = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let wins = 0;
    let losses = 0;
    let winCount = 0;
    let decidedCount = 0;

    for (const fc of resolved) {
      if (fc.outcome !== "hit" && fc.outcome !== "miss") continue;
      decidedCount++;
      const retPct = fc.realizedReturnNet ?? 0;
      const pnl = (retPct / 100) * NOTional_PER_TRADE_USD;
      cum += pnl;
      if (fc.outcome === "hit") winCount++;
      peak = Math.max(peak, cum);
      maxDd = Math.max(maxDd, peak - cum);
      if (pnl >= 0) {
        grossWin += pnl;
        wins++;
      } else {
        grossLoss += Math.abs(pnl);
        losses++;
      }
      points.push({
        t: (fc.resolvedAt ?? fc.createdAt).toISOString(),
        pnlUsd: Number(pnl.toFixed(2)),
        cumPnlUsd: Number(cum.toFixed(2)),
        outcome: fc.outcome,
        asset: fc.asset,
        retPct: Number(retPct.toFixed(3)),
      });
    }

    const equity = {
      points,
      totalPnlUsd: Number(cum.toFixed(2)),
      tradesCount: decidedCount,
      goalProgressPct: Number(((cum / GOAL_USD) * 100).toFixed(1)),
      maxDrawdownUsd: Number(maxDd.toFixed(2)),
      profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : wins > 0 ? 99 : 0,
      expectancyUsd: decidedCount > 0 ? Number((cum / decidedCount).toFixed(2)) : 0,
      avgWinUsd: wins > 0 ? Number((grossWin / wins).toFixed(2)) : 0,
      avgLossUsd: losses > 0 ? Number((grossLoss / losses).toFixed(2)) : 0,
      winRate: decidedCount > 0 ? Number(((winCount / decidedCount) * 100).toFixed(1)) : 0,
    };

    /* ---------------- Strategy leaderboard (grouped by category signature) ---------------- */

    const groups = new Map<
      string,
      {
        key: string;
        categories: string[];
        direction: string;
        n: number;
        hits: number;
        misses: number;
        retSumBps: number;
        pnlUsd: number;
        grossW: number;
        grossL: number;
        mfeSum: number;
        maeSum: number;
        lastSeen: string;
      }
    >();

    for (const fc of resolved) {
      if (fc.outcome !== "hit" && fc.outcome !== "miss") continue;
      const hyp = fc.hypothesisId ? hypMap.get(fc.hypothesisId) : null;
      const cats = Array.isArray(hyp?.categoriesJson) ? (hyp!.categoriesJson as string[]) : [];
      const signature =
        cats.length > 0
          ? [...cats].sort().slice(0, 3).join("+") + "|" + fc.direction
          : "mixed|" + fc.direction;

      if (!groups.has(signature)) {
        groups.set(signature, {
          key: signature,
          categories: cats.slice(0, 4),
          direction: fc.direction,
          n: 0,
          hits: 0,
          misses: 0,
          retSumBps: 0,
          pnlUsd: 0,
          grossW: 0,
          grossL: 0,
          mfeSum: 0,
          maeSum: 0,
          lastSeen: fc.createdAt.toISOString(),
        });
      }
      const g = groups.get(signature)!;
      const retPct = fc.realizedReturnNet ?? 0;
      const pnl = (retPct / 100) * NOTional_PER_TRADE_USD;
      g.n++;
      if (fc.outcome === "hit") g.hits++;
      else g.misses++;
      g.retSumBps += retPct * 100;
      g.pnlUsd += pnl;
      if (pnl >= 0) g.grossW += pnl;
      else g.grossL += Math.abs(pnl);
      g.mfeSum += fc.mfe ?? 0;
      g.maeSum += fc.mae ?? 0;
      if (fc.createdAt.toISOString() > g.lastSeen) g.lastSeen = fc.createdAt.toISOString();
    }

    const leaderboard = [...groups.values()]
      .map((g) => {
        const hitRate = (g.hits / g.n) * 100;
        const lb = wilsonLowerBound(g.hits, g.n);
        const expectancyBps = g.retSumBps / g.n;
        let status: "validated" | "promising" | "testing" | "invalid" = "testing";
        if (g.n >= 8 && lb >= 0.55 && expectancyBps > 0) status = "validated";
        else if (g.n >= 8 && lb < 0.45 && expectancyBps <= 0) status = "invalid";
        else if (
          (g.n >= 5 && lb >= 0.48 && expectancyBps > 0) ||
          (g.n >= 3 && hitRate >= 65 && expectancyBps > 0)
        )
          status = "promising";

        return {
          key: g.key,
          labelRu: g.categories
            .map(
              (c) =>
                CATEGORY_DEFINITIONS[c as keyof typeof CATEGORY_DEFINITIONS]?.labelRu ??
                c.replace(/_/g, " ")
            )
            .join(" + "),
          categories: g.categories,
          direction: g.direction,
          n: g.n,
          hits: g.hits,
          misses: g.misses,
          hitRate: Number(hitRate.toFixed(1)),
          wilsonLb: Number(lb.toFixed(3)),
          expectancyBps: Number(expectancyBps.toFixed(1)),
          totalPnlUsd: Number(g.pnlUsd.toFixed(2)),
          profitFactor: g.grossL > 0 ? Number((g.grossW / g.grossL).toFixed(2)) : g.grossW > 0 ? 99 : 0,
          avgMfe: Number((g.mfeSum / g.n).toFixed(2)),
          avgMae: Number((g.maeSum / g.n).toFixed(2)),
          status,
          lastSeen: g.lastSeen,
          regimes: [] as string[],
        };
      })
      .sort((a, b) => b.wilsonLb * Math.min(b.n, 20) - a.wilsonLb * Math.min(a.n, 20));

    /* ---------------- Regime matrix (from learned per-regime tallies) ---------------- */

    const weights = await db.select().from(learningWeights);
    const regimeTotals = new Map<string, { n: number; hits: number }>();
    for (const w of weights) {
      const rp = w.regimePerformanceJson as Record<string, { hits: number; total: number }> | null;
      if (!rp) continue;
      for (const [regime, tally] of Object.entries(rp)) {
        if (!regimeTotals.has(regime)) regimeTotals.set(regime, { n: 0, hits: 0 });
        const agg = regimeTotals.get(regime)!;
        agg.n += tally.total || 0;
        agg.hits += tally.hits || 0;
      }
    }

    const regimeMatrix = Object.entries(REGIME_LABELS).map(([regime, labelRu]) => {
      const agg = regimeTotals.get(regime) ?? { n: 0, hits: 0 };
      return {
        regime,
        labelRu,
        n: agg.n,
        hits: agg.hits,
        hitRate: agg.n > 0 ? Number(((agg.hits / agg.n) * 100).toFixed(1)) : 0,
      };
    });

    /* ---------------- Error taxonomy ---------------- */

    const errorCounts: Record<string, number> = {};
    for (const fc of resolved) {
      if (fc.outcome !== "miss") continue;
      const et = fc.errorType || "weak_signal";
      errorCounts[et] = (errorCounts[et] || 0) + 1;
    }
    const totalErr = Object.values(errorCounts).reduce((a, b) => a + b, 0);
    const ERR_META: Record<string, { ru: string; fix: string }> = {
      weak_signal: { ru: "Слабый сигнал", fix: "Порог EVS ≥ 72 и ≥ 3 соглас. категории" },
      wrong_sign: { ru: "Неверный знак", fix: "VETO против crowd-funding экстремумов" },
      wrong_horizon: { ru: "Неверный горизонт", fix: "Сетка 15m/1h/4h с отдельной статистикой" },
      regime_mismatch: { ru: "Режим не совпал", fix: "Торговать только в профильном режиме" },
      cost_drag: { ru: "Издержки > edge", fix: "Ход ≥ 3× round-trip издержек" },
      insufficient_liquidity: { ru: "Нет ликвидности", fix: "Фильтр RVOL ≥ 1.4" },
      category_conflict: { ru: "Конфликт категорий", fix: "Штраф за рассогласование > 30%" },
      external_event: { ru: "Внешнее событие", fix: "Пауза вокруг макро-релизов" },
      data_gap: { ru: "Разрыв данных", fix: "Скип цикла при quality ≠ OK" },
    };

    const errors = Object.entries(errorCounts)
      .map(([type, count]) => ({
        type,
        labelRu: ERR_META[type]?.ru ?? type,
        fixRu: ERR_META[type]?.fix ?? "—",
        count,
        sharePct: totalErr > 0 ? Number(((count / totalErr) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    /* ---------------- Rolling decay monitor ---------------- */

    const WINDOW = 20;
    const decided = resolved.filter((f) => f.outcome === "hit" || f.outcome === "miss");
    const recent = decided.slice(-WINDOW);
    const previous = decided.slice(-WINDOW * 2, -WINDOW);
    const roll = (set: typeof decided) =>
      set.length > 0 ? (set.filter((f) => f.outcome === "hit").length / set.length) * 100 : 0;
    const recentHr = roll(recent);
    const prevHr = roll(previous);

    /* ------------- Category contribution (lift-анализ каждой категории) ------------- */

    const allCatKeys = new Set<string>();
    for (const h of hypList) {
      if (Array.isArray(h.categoriesJson)) (h.categoriesJson as string[]).forEach((c) => allCatKeys.add(c));
    }
    const categoryContribution = [...allCatKeys]
      .map((cat) => {
        let withN = 0, withH = 0, withoutN = 0, withoutH = 0;
        for (const fc of decided) {
          const hyp = fc.hypothesisId ? hypMap.get(fc.hypothesisId) : null;
          const cats = Array.isArray(hyp?.categoriesJson) ? (hyp!.categoriesJson as string[]) : [];
          const has = cats.includes(cat);
          if (has) {
            withN++;
            if (fc.outcome === "hit") withH++;
          } else {
            withoutN++;
            if (fc.outcome === "hit") withoutH++;
          }
        }
        const hrWith = withN > 0 ? (withH / withN) * 100 : 0;
        const hrWithout = withoutN > 0 ? (withoutH / withoutN) * 100 : 0;
        return {
          category: cat,
          labelRu: CATEGORY_DEFINITIONS[cat as keyof typeof CATEGORY_DEFINITIONS]?.labelRu ?? cat,
          nWith: withN,
          hrWith: Number(hrWith.toFixed(1)),
          nWithout: withoutN,
          hrWithout: Number(hrWithout.toFixed(1)),
          lift: Number((hrWith - hrWithout).toFixed(1)),
        };
      })
      .filter((c) => c.nWith >= 2)
      .sort((a, b) => b.lift - a.lift);

    /* ------------- Threshold advisor (автокалибровка отсечки EVS) ------------- */

    const scoreOf = (hyp: HypLite | null | undefined): number => {
      const sc = hyp?.scoreComponentsJson as { total?: number } | null | undefined;
      return typeof sc?.total === "number" ? sc.total : 0;
    };
    const thresholdGrid = [45, 55, 60, 65, 70, 75, 80];
    const thresholdAdvisor = thresholdGrid.map((cut) => {
      const subset = decided.filter((fc) => {
        const hyp = fc.hypothesisId ? hypMap.get(fc.hypothesisId) : null;
        return scoreOf(hyp) >= cut;
      });
      const h = subset.filter((f) => f.outcome === "hit").length;
      const expBps = subset.length > 0 ? subset.reduce((a, f) => a + (f.realizedReturnNet ?? 0) * 100, 0) / subset.length : 0;
      return {
        cutoff: cut,
        n: subset.length,
        hitRate: subset.length > 0 ? Number(((h / subset.length) * 100).toFixed(1)) : 0,
        expectancyBps: Number(expBps.toFixed(1)),
      };
    });
    const viable = thresholdAdvisor.filter((t) => t.n >= 8);
    const bestCutoff = viable.length
      ? viable.reduce((a, b) => (b.expectancyBps > a.expectancyBps ? b : a)).cutoff
      : 60;

    /* ------------- Research funnel (воронка: где сигналы отмирают) ------------- */

    let combosStored: unknown[] = [];
    try {
      combosStored = await db.select().from(combinationsTable);
    } catch {
      combosStored = [];
    }
    const totalHyps = hypList.length;
    const validatedN = leaderboard.filter((l) => l.status === "validated").length;
    const funnel = [
      { stage: "Сырые сигналы", count: 90, note: "6 активов × 15 категорий" },
      { stage: "Комбинации за цикл", count: 100, note: "30 пар + 40 троек + 20 квадро + 10 VETO" },
      { stage: "Сохранены в аудит", count: combosStored.length || 25, note: "топ-25 по EVS каждого цикла" },
      { stage: "Оформлены в гипотезы", count: totalHyps, note: "EVS ≥ 60, фальсифицируемые" },
      { stage: "Проверены исходом", count: decided.length, note: "hit / miss после издержек" },
      { stage: "Валидированные методики", count: validatedN, note: "Wilson LB ≥ 55%, n ≥ 8" },
    ];

    return NextResponse.json({
      success: true,
      capital: { notionalPerTradeUsd: NOTional_PER_TRADE_USD, goalUsd: GOAL_USD },
      equity,
      leaderboard,
      regimeMatrix,
      errors,
      rolling: {
        recentHitRate: Number(recentHr.toFixed(1)),
        previousHitRate: Number(prevHr.toFixed(1)),
        delta: Number((recentHr - prevHr).toFixed(1)),
        windowSize: WINDOW,
      },
      categoryContribution,
      thresholdAdvisor,
      bestCutoff,
      funnel,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to compute edge analytics";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
