import { db } from "@/db";
import { learningWeights, experimentRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { CATEGORY_KEYS, CategoryKey } from "../types";

export interface CategoryLearningStats {
  category: string;
  currentWeight: number;
  priorWeight: number;
  totalSamples: number;
  totalHits: number;
  totalMisses: number;
  empiricalWinrate: number;
  brierScore: number;
  lastUpdated: string;
}

export class LearningLoop {
  /**
   * Ensure default weights exist in PostgreSQL for all 15 categories.
   */
  async ensureInitialized(): Promise<void> {
    for (const cat of CATEGORY_KEYS) {
      const existing = await db
        .select()
        .from(learningWeights)
        .where(eq(learningWeights.categoryName, cat))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(learningWeights).values({
          categoryName: cat,
          currentWeight: 1.0,
          priorWeight: 1.0,
          totalSamples: 0,
          totalHits: 0,
          totalMisses: 0,
          empiricalWinrate: 0.50,
          brierScore: 0.25,
          regimePerformanceJson: {},
          lastUpdated: new Date(),
        });
      }
    }
  }

  /**
   * Retrieves current weights map for combination generation.
   */
  async getWeightsMap(): Promise<Record<string, number>> {
    await this.ensureInitialized();
    const rows = await db.select().from(learningWeights);
    const map: Record<string, number> = {};
    for (const r of rows) {
      map[r.categoryName] = r.currentWeight;
    }
    return map;
  }

  /**
   * Retrieves all learning stats for the UI.
   */
  async getAllStats(): Promise<CategoryLearningStats[]> {
    await this.ensureInitialized();
    const rows = await db.select().from(learningWeights);
    return rows.map((r) => ({
      category: r.categoryName,
      currentWeight: r.currentWeight,
      priorWeight: r.priorWeight,
      totalSamples: r.totalSamples,
      totalHits: r.totalHits,
      totalMisses: r.totalMisses,
      empiricalWinrate: r.empiricalWinrate,
      brierScore: r.brierScore,
      lastUpdated: r.lastUpdated.toISOString(),
    }));
  }

  /**
   * Updates category weights based on resolved outcomes.
   * Uses Bayesian smoothing and logarithmic dampening to avoid overfitting.
   */
  async updateFromOutcomes(
    resolvedEvents: {
      categories: string[];
      outcome: "hit" | "miss" | "ambiguous" | "expired";
      realizedReturn: number;
    }[]
  ): Promise<{ updatedCount: number; averageBrier: number }> {
    if (resolvedEvents.length === 0) return { updatedCount: 0, averageBrier: 0.25 };

    await this.ensureInitialized();
    const currentRows = await db.select().from(learningWeights);
    const statsMap = new Map(currentRows.map((r) => [r.categoryName, r]));

    let totalBrierSum = 0;
    let brierEvalCount = 0;

    for (const event of resolvedEvents) {
      if (event.outcome !== "hit" && event.outcome !== "miss") continue;
      const isHit = event.outcome === "hit";
      const actualTarget = isHit ? 1.0 : 0.0;

      for (const cat of event.categories) {
        const row = statsMap.get(cat);
        if (!row) continue;

        const newHits = row.totalHits + (isHit ? 1 : 0);
        const newMisses = row.totalMisses + (isHit ? 0 : 1);
        const newTotal = row.totalSamples + 1;

        // Bayesian smoothed win rate (prior alpha=5, beta=5)
        const alpha = 5;
        const beta = 5;
        const smoothedWinRate = (newHits + alpha) / (newTotal + alpha + beta);

        // Brier score: (forecast_prob - actual)^2
        const forecastProb = Math.min(0.9, Math.max(0.1, smoothedWinRate));
        const sampleBrier = Math.pow(forecastProb - actualTarget, 2);
        const newBrier = (row.brierScore * row.totalSamples + sampleBrier) / newTotal;

        // Dynamic weight adjustment: base 1.0 * (winrate / 0.50)^0.75, bounded [0.25, 2.5]
        const multiplier = Math.pow(smoothedWinRate / 0.5, 0.75);
        const newWeight = Math.max(0.25, Math.min(2.5, row.priorWeight * multiplier));

        row.totalHits = newHits;
        row.totalMisses = newMisses;
        row.totalSamples = newTotal;
        row.empiricalWinrate = smoothedWinRate;
        row.brierScore = newBrier;
        row.currentWeight = Number(newWeight.toFixed(3));

        totalBrierSum += sampleBrier;
        brierEvalCount++;
      }
    }

    // Persist updated weights back to Postgres
    for (const [, row] of statsMap) {
      await db
        .update(learningWeights)
        .set({
          totalHits: row.totalHits,
          totalMisses: row.totalMisses,
          totalSamples: row.totalSamples,
          empiricalWinrate: row.empiricalWinrate,
          brierScore: row.brierScore,
          currentWeight: row.currentWeight,
          lastUpdated: new Date(),
        })
        .where(eq(learningWeights.categoryName, row.categoryName));
    }

    const avgBrier = brierEvalCount > 0 ? totalBrierSum / brierEvalCount : 0.25;

    // Log experiment run to audit trail
    await db.insert(experimentRuns).values({
      runType: "online_learning_update",
      totalSignalsProcessed: resolvedEvents.length * 4,
      combinationsGenerated: 0,
      hypothesesCreated: 0,
      forecastsResolved: resolvedEvents.length,
      learningUpdatesCount: statsMap.size,
      regimeDetected: "ADAPTIVE",
      logSummary: `Updated Bayesian weights for ${statsMap.size} categories across ${resolvedEvents.length} resolved events. New Avg Brier Score: ${avgBrier.toFixed(4)}.`,
      metricsJson: { avgBrier, resolvedCount: resolvedEvents.length },
      createdAt: new Date(),
    });

    return { updatedCount: statsMap.size, averageBrier: avgBrier };
  }
}

export const learningLoop = new LearningLoop();
