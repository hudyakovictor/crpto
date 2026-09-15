import { db } from "@/db";
import {
  assets,
  candles as candlesTable,
  signalFeatures,
  combinations as combinationsTable,
  hypotheses as hypothesesTable,
  forecasts as forecastsTable,
  experimentRuns,
  dataQualityLogs,
} from "@/db/schema";
import { eq, lte, and } from "drizzle-orm";
import { okxClient, TRACKED_SYMBOLS } from "../okx/okx-client";
import { featureEngine } from "./feature-engine";
import { combinationEngine } from "./combination-engine";
import { hypothesisEngine } from "./hypothesis-engine";
import { outcomeEvaluator } from "./outcome-evaluator";
import { learningLoop } from "./learning-loop";
import { CategoryKey, MarketRegime, OKXCandle } from "../types";
import { loadFilters } from "../filters";

export interface CycleResult {
  timestamp: string;
  isLiveOKX: boolean;
  latencyMs: number;
  trackedCount: number;
  marketRegime: MarketRegime;
  combinationsGenerated: number;
  hypothesesCreated: number;
  forecastsResolved: number;
  learningUpdated: boolean;
  summary: string;
}

export class AutonomousScheduler {
  private isRunning = false;
  private lastRunTime: Date | null = null;
  private nextRunTime: Date | null = null;
  private intervalMinutes = 15;

  getLastRunTime(): Date | null {
    return this.lastRunTime;
  }

  getNextRunTime(): Date | null {
    if (!this.lastRunTime) {
      return new Date(Date.now() + 15 * 60 * 1000);
    }
    return new Date(this.lastRunTime.getTime() + this.intervalMinutes * 60 * 1000);
  }

  /**
   * Run one full autonomous quant research cycle.
   */
  async runCycle(isManualTrigger = false): Promise<CycleResult> {
    if (this.isRunning) {
      return {
        timestamp: new Date().toISOString(),
        isLiveOKX: true,
        latencyMs: 0,
        trackedCount: 0,
        marketRegime: "NEUTRAL_CONSOLIDATION",
        combinationsGenerated: 0,
        hypothesesCreated: 0,
        forecastsResolved: 0,
        learningUpdated: false,
        summary: "Cycle already in progress. Skipping concurrent run.",
      };
    }

    this.isRunning = true;
    const cycleStartTime = Date.now();

    try {
      await learningLoop.ensureInitialized();

      // Step 1: Fetch Live Tickers from OKX
      const { tickers, latencyMs, isLive: isLiveTickers } = await okxClient.getTickers();

      // Upsert assets to Postgres
      for (const t of tickers) {
        const [base, quote] = t.instId.split("-");
        const change24h = t.open24h > 0 ? ((t.last - t.open24h) / t.open24h) * 100 : 0;

        const existing = await db.select().from(assets).where(eq(assets.symbol, t.instId)).limit(1);
        if (existing.length > 0) {
          await db
            .update(assets)
            .set({
              lastPrice: t.last,
              priceChange24h: change24h,
              volume24h: t.vol24h,
              high24h: t.high24h,
              low24h: t.low24h,
              lastFetchedAt: new Date(),
            })
            .where(eq(assets.symbol, t.instId));
        } else {
          await db.insert(assets).values({
            symbol: t.instId,
            baseAsset: base || "CRYPTO",
            quoteAsset: quote || "USDT",
            exchange: "OKX",
            lastPrice: t.last,
            priceChange24h: change24h,
            volume24h: t.vol24h,
            high24h: t.high24h,
            low24h: t.low24h,
            isActive: true,
            lastFetchedAt: new Date(),
          });
        }
      }

      // Step 2: Fetch Candles & Microstructure Data for BTC and Target Symbols
      const candlesMap = new Map<string, OKXCandle[]>();
      let btcCandles: OKXCandle[] = [];

      for (const sym of TRACKED_SYMBOLS) {
        const { candles } = await okxClient.getCandles(sym, "15m", 60);
        candlesMap.set(sym, candles);
        if (sym === "BTC-USDT") {
          btcCandles = candles;
        }

        // Store latest 3 candles in db
        for (const c of candles.slice(-3)) {
          const cDate = new Date(c.timestamp);
          const existing = await db
            .select()
            .from(candlesTable)
            .where(and(eq(candlesTable.symbol, sym), eq(candlesTable.timestamp, cDate)))
            .limit(1);

          if (existing.length === 0) {
            await db.insert(candlesTable).values({
              symbol: sym,
              timeframe: "15m",
              timestamp: cDate,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
              volCcy: c.volCcy,
              confirmed: true,
            });
          }
        }
      }

      // Step 3: Check and Resolve Due Forecasts
      const pendingForecasts = await db
        .select()
        .from(forecastsTable)
        .where(eq(forecastsTable.status, "pending"));

      const now = new Date();
      const resolvedEventsForLearning: {
        categories: string[];
        outcome: "hit" | "miss" | "ambiguous" | "expired";
        realizedReturn: number;
      }[] = [];

      let resolvedCount = 0;

      for (const fc of pendingForecasts) {
        // Resolve if past resolution time or if manual trigger testing
        const isPastHorizon = new Date(fc.resolveAt) <= now;
        if (isPastHorizon) {
          const symCandles = candlesMap.get(fc.asset) || [];
          const currentPrice = tickers.find((t) => t.instId === fc.asset)?.last || fc.entryPrice;

          const resolution = outcomeEvaluator.evaluate(fc, currentPrice, symCandles);

          await db
            .update(forecastsTable)
            .set({
              status: "resolved",
              outcome: resolution.outcome,
              resolvedPrice: resolution.resolvedPrice,
              mfe: resolution.mfe,
              mae: resolution.mae,
              realizedReturnNet: resolution.realizedReturnNet,
              errorType: resolution.errorType,
              resolvedAt: resolution.resolvedAt,
            })
            .where(eq(forecastsTable.id, fc.id));

          resolvedCount++;

          // Look up corresponding hypothesis categories
          if (fc.hypothesisId) {
            const hyp = await db
              .select()
              .from(hypothesesTable)
              .where(eq(hypothesesTable.id, fc.hypothesisId))
              .limit(1);

            if (hyp.length > 0 && Array.isArray(hyp[0].categoriesJson)) {
              resolvedEventsForLearning.push({
                categories: hyp[0].categoriesJson as string[],
                outcome: resolution.outcome,
                realizedReturn: resolution.realizedReturnNet,
              });

              // Update hypothesis status
              await db
                .update(hypothesesTable)
                .set({
                  status: resolution.outcome === "hit" ? "fulfilled" : "invalidated",
                })
                .where(eq(hypothesesTable.id, fc.hypothesisId));
            }
          }
        }
      }

      // Step 4: Online Learning - Update weights in Postgres based on accumulated outcomes
      let learningUpdated = false;
      if (resolvedEventsForLearning.length > 0) {
        await learningLoop.updateFromOutcomes(resolvedEventsForLearning);
        learningUpdated = true;
      }

      // Step 5: Get Current Learned Weights
      const currentWeights = await learningLoop.getWeightsMap();

      // Step 6: Market Regime Detection
      const detectedRegime = featureEngine.detectRegime(btcCandles);

      // Step 7: Compute 15 Signal Categories for Primary Target (BTC-USDT & ETH-USDT)
      const primarySymbol = "BTC-USDT";
      const primaryCandles = candlesMap.get(primarySymbol) || [];
      const { book } = await okxClient.getOrderBook(primarySymbol, 20);
      const { funding } = await okxClient.getFundingRate(primarySymbol);
      const { oi } = await okxClient.getOpenInterest(primarySymbol);

      const allTickersPerf = tickers.map((t) => ({
        symbol: t.instId,
        change24h: t.open24h > 0 ? ((t.last - t.open24h) / t.open24h) * 100 : 0,
        volume: t.vol24h,
      }));

      const signals15 = featureEngine.calculate15Categories({
        symbol: primarySymbol,
        candles: primaryCandles,
        book,
        funding,
        oi,
        btcCandles,
        allTickersPerformance: allTickersPerf,
      });

      // Save signals snapshot to Postgres
      for (const [catKey, sig] of Object.entries(signals15)) {
        await db.insert(signalFeatures).values({
          symbol: primarySymbol,
          category: catKey,
          primitiveName: sig.primitiveName,
          rawValue: sig.rawValue,
          normalizedScore: sig.normalizedScore,
          direction: sig.direction,
          confidence: sig.confidence,
          missingness: sig.missingness,
          supportCount: sig.supportCount,
          timestamp: new Date(),
          metadataJson: sig.metadata || {},
        });
      }

      // Step 8: Combinatorial Exploration - Generate Exactly 100 Variations!
      const combinations100 = combinationEngine.generate100Combinations(
        primarySymbol,
        signals15,
        detectedRegime,
        currentWeights,
        isLiveTickers ? 9.8 : 7.5
      );

      // Store top 25 combinations to database for audit
      for (const combo of combinations100.slice(0, 25)) {
        const existing = await db
          .select()
          .from(combinationsTable)
          .where(eq(combinationsTable.code, combo.code))
          .limit(1);

        if (existing.length === 0) {
          await db.insert(combinationsTable).values({
            code: combo.code,
            name: combo.name,
            expression: combo.expression,
            categoriesJson: combo.categories,
            parametersJson: combo.parameters,
            earlyValueScore: combo.earlyValueScore,
            noveltyScore: combo.breakdown.novelty,
            crossAgreementScore: combo.breakdown.crossAgreement,
            historicalSupportScore: combo.breakdown.historicalSupport,
            stabilityScore: combo.breakdown.effectStability,
            liquidityScore: combo.breakdown.coverageLiquidity,
            dataQualityScore: combo.breakdown.dataQuality,
            testabilityScore: combo.breakdown.testability,
            sampleSize: combo.sampleSize,
            status: combo.status,
            createdAt: new Date(),
          });
        }
      }

      // Step 9: Find Early Signal Candidates & Generate Hypotheses + Forecasts
      // Порог EVS берётся из пользовательских фильтров (панель настроек)
      let minEvsGate = 30;
      let maxHyps = 40;
      try {
        const f = await loadFilters();
        minEvsGate = f.minEvs;
        maxHyps = f.maxHypothesesPerCycle;
      } catch {
        minEvsGate = 30;
        maxHyps = 40;
      }
      // Массовый отбор: всё, что проходит порог EVS, идёт в тест независимо от
      // предварительного статуса — нерелевантное отсеется исходами, полезное
      // осядет в истории и в памяти ИИ.
      const topCandidates = combinations100.filter((c) => c.earlyValueScore >= minEvsGate);

      let hypothesesCreated = 0;
      const primaryTicker = tickers.find((t) => t.instId === primarySymbol);
      const currentPrice = primaryTicker?.last || (primaryCandles.length > 0 ? primaryCandles[primaryCandles.length - 1].close : 78000);

      // Массовое тестирование: до maxHyps связок за цикл — нерелевантное отсеется
      // статистикой, полезное накопит историю для обучения и AI-памяти.
      for (const candidate of topCandidates.slice(0, maxHyps)) {
        const { hypothesis, forecast } = hypothesisEngine.createHypothesis(
          candidate,
          primarySymbol,
          currentPrice,
          15 // 15-minute horizon
        );

        const [createdHyp] = await db
          .insert(hypothesesTable)
          .values({
            code: hypothesis.code,
            asset: hypothesis.asset,
            venue: hypothesis.venue,
            timeframe: hypothesis.timeframe,
            direction: hypothesis.direction,
            horizonMinutes: hypothesis.horizonMinutes,
            entryPrice: hypothesis.entryPrice,
            targetPrice: hypothesis.targetPrice,
            invalidationPrice: hypothesis.invalidationPrice,
            expectedMechanism: hypothesis.expectedMechanism,
            categoriesJson: hypothesis.categories,
            exactFormula: hypothesis.exactFormula,
            parameterSetId: hypothesis.parameterSetId,
            dataVersion: hypothesis.dataVersion,
            scoreComponentsJson: hypothesis.scoreComponents,
            uncertainty: hypothesis.uncertainty,
            status: "active",
            createdAt: new Date(),
          })
          .returning({ id: hypothesesTable.id });

        await db.insert(forecastsTable).values({
          hypothesisId: createdHyp ? createdHyp.id : null,
          asset: forecast.asset,
          direction: forecast.direction,
          horizonMinutes: forecast.horizonMinutes,
          fixedAt: forecast.fixedAt,
          resolveAt: forecast.resolveAt,
          entryPrice: forecast.entryPrice,
          expectedMinPrice: forecast.expectedMinPrice,
          expectedMaxPrice: forecast.expectedMaxPrice,
          targetCondition: forecast.targetCondition,
          invalidationCondition: forecast.invalidationCondition,
          costsBps: forecast.costsBps,
          slippageBps: forecast.slippageBps,
          fundingDragBps: forecast.fundingDragBps,
          checksum: forecast.checksum,
          status: "pending",
          createdAt: new Date(),
        });

        hypothesesCreated++;
      }

      // Step 10: Log Quality Metrics
      await db.insert(dataQualityLogs).values({
        source: isLiveTickers ? "OKX-REST-LIVE" : "OKX-SYNTHETIC-FALLBACK",
        metricType: "latency",
        status: latencyMs < 1000 ? "OK" : "WARN",
        latencyMs,
        details: `Fetched ${tickers.length} tickers, ${candlesMap.size} candle series. Latency: ${latencyMs}ms.`,
        createdAt: new Date(),
      });

      // Step 11: Log Experiment Record
      const summaryText = `OKX Cycle completed: ${tickers.length} assets, regime ${detectedRegime}, 100 combinations evaluated, ${hypothesesCreated} hypotheses formed, ${resolvedCount} forecasts resolved, online learning updated: ${learningUpdated}. Latency: ${latencyMs}ms.`;

      await db.insert(experimentRuns).values({
        runType: isManualTrigger ? "manual_trigger_15m" : "scheduled_15m",
        totalSignalsProcessed: Object.keys(signals15).length,
        combinationsGenerated: combinations100.length,
        hypothesesCreated,
        forecastsResolved: resolvedCount,
        learningUpdatesCount: learningUpdated ? 15 : 0,
        regimeDetected: detectedRegime,
        logSummary: summaryText,
        metricsJson: {
          latencyMs,
          isLiveOKX: isLiveTickers,
          topScore: combinations100[0]?.earlyValueScore || 0,
        },
        createdAt: new Date(),
      });

      this.lastRunTime = new Date();
      this.nextRunTime = new Date(Date.now() + this.intervalMinutes * 60 * 1000);

      return {
        timestamp: this.lastRunTime.toISOString(),
        isLiveOKX: isLiveTickers,
        latencyMs,
        trackedCount: tickers.length,
        marketRegime: detectedRegime,
        combinationsGenerated: combinations100.length,
        hypothesesCreated,
        forecastsResolved: resolvedCount,
        learningUpdated,
        summary: summaryText,
      };
    } finally {
      this.isRunning = false;
    }
  }
}

export const autonomousScheduler = new AutonomousScheduler();
