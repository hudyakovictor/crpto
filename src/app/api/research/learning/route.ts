import { NextResponse } from "next/server";
import { db } from "@/db";
import { learningWeights, experimentRuns, forecasts, hypotheses } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { learningLoop } from "@/lib/quant/learning-loop";
import { CATEGORY_DEFINITIONS } from "@/lib/types";

export async function GET() {
  try {
    await learningLoop.ensureInitialized();
    const weightsList = await db.select().from(learningWeights);
    const experimentHistory = await db
      .select()
      .from(experimentRuns)
      .orderBy(desc(experimentRuns.createdAt))
      .limit(15);

    const resolvedForecasts = await db
      .select()
      .from(forecasts)
      .where(eq(forecasts.status, "resolved"));
    const hypothesisRows = await db
      .select({ id: hypotheses.id, uncertainty: hypotheses.uncertainty })
      .from(hypotheses);
    const hypothesisMap = new Map(hypothesisRows.map((h) => [h.id, h]));

    // Calculate error taxonomy counts
    const errorDistribution: Record<string, number> = {
      none: 0,
      weak_signal: 0,
      wrong_sign: 0,
      wrong_horizon: 0,
      regime_mismatch: 0,
      cost_drag: 0,
    };

    for (const fc of resolvedForecasts) {
      const err = fc.errorType || "none";
      errorDistribution[err] = (errorDistribution[err] || 0) + 1;
    }

    // Reliability & calibration bins from the stored forecast uncertainty.
    const calibrationDefinitions = [
      { label: "0.40 - 0.50", min: 0.40, max: 0.50 },
      { label: "0.50 - 0.60", min: 0.50, max: 0.60 },
      { label: "0.60 - 0.70", min: 0.60, max: 0.70 },
      { label: "0.70 - 0.85", min: 0.70, max: 0.85 },
    ];
    const calibrationSamples = resolvedForecasts
      .filter((fc) => fc.outcome === "hit" || fc.outcome === "miss")
      .map((fc) => {
        const uncertainty = fc.hypothesisId === null
          ? 0.5
          : hypothesisMap.get(fc.hypothesisId)?.uncertainty ?? 0.5;
        return {
          predictedProb: Math.min(0.85, Math.max(0.40, 1 - uncertainty)),
          hit: fc.outcome === "hit",
        };
      });
    const calibrationBins = calibrationDefinitions.flatMap(({ label, min, max }) => {
      const samples = calibrationSamples.filter((sample) =>
        sample.predictedProb >= min && (sample.predictedProb < max || (max === 0.85 && sample.predictedProb <= max))
      );
      if (samples.length === 0) return [];
      return [{
        bin: label,
        predictedProb: samples.reduce((sum, sample) => sum + sample.predictedProb, 0) / samples.length,
        actualHitRate: samples.filter((sample) => sample.hit).length / samples.length,
        count: samples.length,
      }];
    });

    const enrichedWeights = weightsList.map((w) => ({
      ...w,
      labelRu: CATEGORY_DEFINITIONS[w.categoryName as keyof typeof CATEGORY_DEFINITIONS]?.labelRu || w.categoryName,
      labelEn: CATEGORY_DEFINITIONS[w.categoryName as keyof typeof CATEGORY_DEFINITIONS]?.labelEn || w.categoryName,
    }));

    return NextResponse.json({
      success: true,
      weights: enrichedWeights,
      experimentHistory,
      errorDistribution,
      calibrationBins,
      totalAccumulatedSamples: weightsList.reduce((acc, w) => acc + w.totalSamples, 0),
      averageBrierScore:
        weightsList.length > 0
          ? (weightsList.reduce((acc, w) => acc + w.brierScore, 0) / weightsList.length).toFixed(4)
          : "0.2500",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load learning data";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    // Retrain on all resolved forecasts in the database
    const resolvedForecasts = await db
      .select()
      .from(forecasts)
      .where(eq(forecasts.status, "resolved"));

    const hypList = await db.select().from(hypotheses);
    const hypMap = new Map(hypList.map((h) => [h.id, h]));

    const eventsForLearning: {
      categories: string[];
      outcome: "hit" | "miss" | "ambiguous" | "expired";
      realizedReturn: number;
    }[] = [];

    for (const fc of resolvedForecasts) {
      if (!fc.hypothesisId) continue;
      const hyp = hypMap.get(fc.hypothesisId);
      if (hyp && Array.isArray(hyp.categoriesJson)) {
        eventsForLearning.push({
          categories: hyp.categoriesJson as string[],
          outcome: (fc.outcome as "hit" | "miss" | "ambiguous" | "expired") || "hit",
          realizedReturn: fc.realizedReturnNet || 0,
        });
      }
    }

    const { updatedCount, averageBrier } = await learningLoop.updateFromOutcomes(eventsForLearning);
    const updatedWeights = await db.select().from(learningWeights);

    return NextResponse.json({
      success: true,
      message: `Successfully learned on ${eventsForLearning.length} accumulated forecast outcomes! Updated ${updatedCount} category weights.`,
      retrainedCount: eventsForLearning.length,
      averageBrierScore: averageBrier,
      updatedWeights,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Learning update failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
