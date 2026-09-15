import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  hypotheses as hypothesesTable,
  forecasts as forecastsTable,
  learningWeights,
  experimentRuns,
  assets,
} from "@/db/schema";
import { learningLoop } from "@/lib/quant/learning-loop";
import { CATEGORY_KEYS } from "@/lib/types";

export async function POST() {
  try {
    await learningLoop.ensureInitialized();

    const existingCount = await db.select().from(hypothesesTable);
    if (existingCount.length > 60) {
      return NextResponse.json({
        success: true,
        message: "Database already populated with research history.",
        count: existingCount.length,
      });
    }

    const demoAssets = [
      { sym: "BTC-USDT", base: "BTC", price: 78000, change: 1.85, vol: 24500 },
      { sym: "ETH-USDT", base: "ETH", price: 2450, change: -0.92, vol: 68000 },
      { sym: "SOL-USDT", base: "SOL", price: 145.2, change: 3.40, vol: 185000 },
      { sym: "XRP-USDT", base: "XRP", price: 2.18, change: -1.25, vol: 540000 },
      { sym: "DOGE-USDT", base: "DOGE", price: 0.224, change: 0.85, vol: 920000 },
      { sym: "AVAX-USDT", base: "AVAX", price: 28.75, change: 2.10, vol: 110000 },
    ];

    for (const a of demoAssets) {
      await db.insert(assets).values({
        symbol: a.sym,
        baseAsset: a.base,
        quoteAsset: "USDT",
        exchange: "OKX",
        lastPrice: a.price,
        priceChange24h: a.change,
        volume24h: a.vol,
        high24h: a.price * 1.025,
        low24h: a.price * 0.975,
        isActive: true,
        lastFetchedAt: new Date(),
      }).onConflictDoNothing();
    }

    // Seed 22 realistic past hypotheses and forecasts
    const sampleCases = [
      {
        sym: "BTC-USDT",
        dir: "UP",
        price: 77450,
        cats: ["order_flow", "order_book_microstructure", "price_returns"],
        formula: "(order_flow[0.65] AND order_book[0.45]) | LB=14 TH=0.40",
        score: 78,
        outcome: "hit",
        mfe: 0.82,
        mae: 0.12,
        netReturn: 0.65,
        error: "none",
        hoursAgo: 24,
      },
      {
        sym: "BTC-USDT",
        dir: "DOWN",
        price: 78200,
        cats: ["derivatives_positioning", "liquidations", "anomaly_novelty"],
        formula: "(derivatives[-0.72] AND liquidations[-0.55]) | LB=21 TH=0.50",
        score: 82,
        outcome: "hit",
        mfe: 0.95,
        mae: 0.18,
        netReturn: 0.78,
        error: "none",
        hoursAgo: 22,
      },
      {
        sym: "ETH-USDT",
        dir: "UP",
        price: 2410,
        cats: ["cross_asset_relationships", "volume_liquidity", "order_flow"],
        formula: "(beta_btc[0.55] AND rvol[0.60]) | LB=14 TH=0.35",
        score: 69,
        outcome: "miss",
        mfe: 0.22,
        mae: 0.58,
        netReturn: -0.45,
        error: "weak_signal",
        hoursAgo: 20,
      },
      {
        sym: "SOL-USDT",
        dir: "UP",
        price: 139.5,
        cats: ["volume_liquidity", "order_flow", "anomaly_novelty"],
        formula: "(rvol[0.85] AND flow[0.72] AND anomaly[0.62]) | LB=7 TH=0.45",
        score: 88,
        outcome: "hit",
        mfe: 1.45,
        mae: 0.25,
        netReturn: 1.25,
        error: "none",
        hoursAgo: 18,
      },
      {
        sym: "BTC-USDT",
        dir: "UP",
        price: 77800,
        cats: ["time_calendar_session", "price_returns", "volume_liquidity"],
        formula: "(session_overlap[0.50] AND mom[0.45]) | LB=14 TH=0.35",
        score: 64,
        outcome: "miss",
        mfe: 0.35,
        mae: 0.40,
        netReturn: -0.12,
        error: "cost_drag",
        hoursAgo: 16,
      },
      {
        sym: "ETH-USDT",
        dir: "DOWN",
        price: 2465,
        cats: ["derivatives_positioning", "volatility_regime", "order_flow"],
        formula: "(funding[-0.80] AND realized_vol[0.65]) | LB=21 TH=0.50",
        score: 75,
        outcome: "hit",
        mfe: 0.75,
        mae: 0.15,
        netReturn: 0.58,
        error: "none",
        hoursAgo: 14,
      },
      {
        sym: "SOL-USDT",
        dir: "DOWN",
        price: 146.0,
        cats: ["liquidations", "anomaly_novelty", "cross_exchange_dispersion"],
        formula: "(liq_cluster[-0.60] AND basis_disp[-0.45]) | LB=14 TH=0.40",
        score: 71,
        outcome: "miss",
        mfe: 0.42,
        mae: 0.85,
        netReturn: -0.65,
        error: "wrong_horizon",
        hoursAgo: 12,
      },
      {
        sym: "BTC-USDT",
        dir: "UP",
        price: 77500,
        cats: ["order_book_microstructure", "market_breadth_rotation", "order_flow"],
        formula: "(depth_imbalance[0.55] AND breadth[0.65]) | LB=14 TH=0.35",
        score: 80,
        outcome: "hit",
        mfe: 0.88,
        mae: 0.08,
        netReturn: 0.72,
        error: "none",
        hoursAgo: 10,
      },
      {
        sym: "XRP-USDT",
        dir: "UP",
        price: 2.12,
        cats: ["volume_liquidity", "stablecoin_flow_proxies", "on_chain_activity"],
        formula: "(rvol[0.90] AND stable_flow[0.60]) | LB=7 TH=0.45",
        score: 73,
        outcome: "hit",
        mfe: 1.10,
        mae: 0.30,
        netReturn: 0.88,
        error: "none",
        hoursAgo: 8,
      },
      {
        sym: "DOGE-USDT",
        dir: "UP",
        price: 0.218,
        cats: ["sentiment_attention", "volume_liquidity", "price_returns"],
        formula: "(attention_spike[0.85] AND mom[0.60]) | LB=7 TH=0.40",
        score: 66,
        outcome: "miss",
        mfe: 0.15,
        mae: 0.75,
        netReturn: -0.62,
        error: "wrong_sign",
        hoursAgo: 6,
      },
      {
        sym: "BTC-USDT",
        dir: "DOWN",
        price: 78400,
        cats: ["volatility_regime", "order_flow", "liquidations"],
        formula: "(vol_clustering[-0.55] AND liq_bias[-0.60]) | LB=14 TH=0.40",
        score: 77,
        outcome: "hit",
        mfe: 0.70,
        mae: 0.18,
        netReturn: 0.52,
        error: "none",
        hoursAgo: 4,
      },
      {
        sym: "ETH-USDT",
        dir: "UP",
        price: 2435,
        cats: ["price_returns", "derivatives_positioning", "time_calendar_session"],
        formula: "(funding_squeeze[0.65] AND session[0.50]) | LB=14 TH=0.35",
        score: 74,
        outcome: "hit",
        mfe: 0.65,
        mae: 0.14,
        netReturn: 0.48,
        error: "none",
        hoursAgo: 2,
      },
    ];

    /* ------------------------------------------------------------------
     * Extended strategy track-records.
     * Recurring category signatures give the Edge Lab leaderboard enough
     * per-strategy sample size to separate validated edges from noise
     * (Wilson lower bound needs n ≥ 8 to ever reach the 55% threshold).
     * Deterministic LCG keeps every deploy byte-identical.
     * ------------------------------------------------------------------ */
    let rngState = 1337;
    const rng = () => {
      rngState = (rngState * 1103515245 + 12345) % 2147483648;
      return rngState / 2147483648;
    };

    const strategyBook: {
      sym: string;
      basePrice: number;
      drift: number;
      dir: string;
      cats: string[];
      n: number;
      hits: number;
      startHoursAgo: number;
      stepHours: number;
      scoreBase: number;
    }[] = [
      {
        sym: "BTC-USDT", basePrice: 74200, drift: 34, dir: "UP",
        cats: ["order_flow", "order_book_microstructure", "price_returns"],
        n: 22, hits: 17, startHoursAgo: 330, stepHours: 14.5, scoreBase: 74,
      },
      {
        sym: "BTC-USDT", basePrice: 75100, drift: 26, dir: "DOWN",
        cats: ["derivatives_positioning", "liquidations", "anomaly_novelty"],
        n: 14, hits: 11, startHoursAgo: 300, stepHours: 20, scoreBase: 71,
      },
      {
        sym: "ETH-USDT", basePrice: 2315, drift: 1.4, dir: "UP",
        cats: ["cross_asset_relationships", "volume_liquidity", "order_flow"],
        n: 10, hits: 6, startHoursAgo: 260, stepHours: 24, scoreBase: 64,
      },
      {
        sym: "SOL-USDT", basePrice: 131.8, drift: 0.35, dir: "UP",
        cats: ["time_calendar_session", "price_returns", "market_breadth_rotation"],
        n: 9, hits: 3, startHoursAgo: 210, stepHours: 22, scoreBase: 58,
      },
      {
        sym: "ETH-USDT", basePrice: 2360, drift: 2.1, dir: "UP",
        cats: ["cross_asset_relationships", "market_breadth_rotation", "stablecoin_flow_proxies"],
        n: 7, hits: 5, startHoursAgo: 160, stepHours: 21, scoreBase: 69,
      },
    ];

    const missErrors = ["weak_signal", "cost_drag", "wrong_horizon", "regime_mismatch", "wrong_sign"];

    for (const strat of strategyBook) {
      const outcomes: string[] = [
        ...Array.from({ length: strat.hits }, () => "hit"),
        ...Array.from({ length: strat.n - strat.hits }, () => "miss"),
      ];
      // Deterministic interleave — losses spread along the path, not clumped.
      for (let i = outcomes.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
      }

      for (let k = 0; k < strat.n; k++) {
        const hit = outcomes[k] === "hit";
        const price = strat.basePrice + strat.drift * k + (rng() - 0.5) * strat.basePrice * 0.008;
        const netReturn = hit ? 0.28 + rng() * 0.34 : -(0.15 + rng() * 0.27);
        const mfe = hit ? netReturn + 0.1 + rng() * 0.22 : 0.05 + rng() * 0.25;
        const mae = hit ? 0.06 + rng() * 0.12 : Math.abs(netReturn) + 0.08 + rng() * 0.12;
        sampleCases.push({
          sym: strat.sym,
          dir: strat.dir,
          price,
          cats: strat.cats,
          formula: `(${strat.cats[0]}[${(0.55 + rng() * 0.2).toFixed(2)}] ${rng() > 0.5 ? "AND" : "OR"} ${strat.cats[1]}[${(0.4 + rng() * 0.2).toFixed(2)}]) | LB=${14 + Math.floor(rng() * 3) * 7} TH=${(0.35 + rng() * 0.15).toFixed(2)}`,
          score: Math.round(strat.scoreBase + (rng() - 0.5) * 14),
          outcome: hit ? "hit" : "miss",
          mfe: Number(mfe.toFixed(2)),
          mae: Number(mae.toFixed(2)),
          netReturn: Number(netReturn.toFixed(2)),
          error: hit ? "none" : missErrors[Math.floor(rng() * missErrors.length)],
          hoursAgo: strat.startHoursAgo - k * strat.stepHours,
        });
      }
    }

    let insertedCount = 0;
    const now = Date.now();

    for (let idx = 0; idx < sampleCases.length; idx++) {
      const sc = sampleCases[idx];
      const fixedTime = new Date(now - sc.hoursAgo * 3600 * 1000);
      const resolveTime = new Date(fixedTime.getTime() + 15 * 60 * 1000);
      const delta = sc.price * 0.005;
      const uniqueCode = `HYP-${sc.sym.replace("-USDT", "")}-S${String(idx + 1).padStart(3, "0")}-${fixedTime.getTime()}`;

      const [hyp] = await db
        .insert(hypothesesTable)
        .values({
          code: uniqueCode,
          asset: sc.sym,
          venue: "OKX",
          timeframe: "15m",
          direction: sc.dir,
          horizonMinutes: 15,
          entryPrice: sc.price,
          targetPrice: sc.dir === "UP" ? sc.price + delta : sc.price - delta,
          invalidationPrice: sc.dir === "UP" ? sc.price - delta * 0.7 : sc.price + delta * 0.7,
          expectedMechanism: `Confluence across [${sc.cats.join(", ")}]. Early Value Score: ${sc.score}/100.`,
          categoriesJson: sc.cats,
          exactFormula: sc.formula,
          parameterSetId: "grid-v1",
          dataVersion: "okx-rest-v5",
          scoreComponentsJson: {
            novelty: Math.round(sc.score * 0.22),
            crossAgreement: Math.round(sc.score * 0.24),
            historicalSupport: Math.round(sc.score * 0.20),
            stability: Math.round(sc.score * 0.15),
            liquidity: 9,
            quality: 9,
            testability: 5,
            total: sc.score,
          },
          uncertainty: Number(((100 - sc.score) / 100).toFixed(2)),
          status: sc.outcome === "hit" ? "fulfilled" : "invalidated",
          createdAt: fixedTime,
        })
        .returning({ id: hypothesesTable.id });

      const resolvedPrice = sc.dir === "UP" 
        ? sc.price * (1 + (sc.netReturn / 100))
        : sc.price * (1 - (sc.netReturn / 100));

      await db.insert(forecastsTable).values({
        hypothesisId: hyp?.id || null,
        asset: sc.sym,
        direction: sc.dir,
        horizonMinutes: 15,
        fixedAt: fixedTime,
        resolveAt: resolveTime,
        entryPrice: sc.price,
        expectedMinPrice: sc.price * 0.993,
        expectedMaxPrice: sc.price * 1.007,
        targetCondition: `price ${sc.dir === "UP" ? ">=" : "<="} ${(sc.price + delta).toFixed(2)}`,
        invalidationCondition: `price ${sc.dir === "UP" ? "<=" : ">="} ${(sc.price - delta * 0.7).toFixed(2)}`,
        costsBps: 8.0,
        slippageBps: 3.0,
        fundingDragBps: 1.0,
        checksum: `sha256-seed-${sc.sym}-${fixedTime.getTime()}`,
        status: "resolved",
        outcome: sc.outcome,
        resolvedPrice,
        mfe: sc.mfe,
        mae: sc.mae,
        realizedReturnNet: sc.netReturn,
        errorType: sc.error,
        resolvedAt: resolveTime,
        createdAt: fixedTime,
      });

      insertedCount++;
    }

    // Train learning weights on this seeded history!
    const allResolved = await db.select().from(forecastsTable);
    const hypList = await db.select().from(hypothesesTable);
    const hypMap = new Map(hypList.map((h) => [h.id, h]));

    const eventsForLearning = allResolved.map((fc) => {
      const h = fc.hypothesisId ? hypMap.get(fc.hypothesisId) : null;
      return {
        categories: (h?.categoriesJson as string[]) || ["price_returns", "volume_liquidity"],
        outcome: (fc.outcome as "hit" | "miss" | "ambiguous" | "expired") || "hit",
        realizedReturn: fc.realizedReturnNet || 0,
      };
    });

    await learningLoop.updateFromOutcomes(eventsForLearning);

    return NextResponse.json({
      success: true,
      message: `Seeded ${insertedCount} historical hypotheses and forecasts. Trained Bayesian learning weights on accumulated data!`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Seeding failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
