import { NextResponse } from "next/server";
import { db } from "@/db";
import { combinations as combinationsTable, learningWeights } from "@/db/schema";
import { desc } from "drizzle-orm";
import { okxClient } from "@/lib/okx/okx-client";
import { featureEngine } from "@/lib/quant/feature-engine";
import { combinationEngine } from "@/lib/quant/combination-engine";
import { comboPasses, loadFilters } from "@/lib/filters";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol") || "BTC-USDT";

    // First check if we should generate fresh 100 combinations on the fly
    const { candles } = await okxClient.getCandles(symbol, "15m", 50);
    const { book } = await okxClient.getOrderBook(symbol, 20);
    const { funding } = await okxClient.getFundingRate(symbol);
    const { oi } = await okxClient.getOpenInterest(symbol);

    const weightsRows = await db.select().from(learningWeights);
    const weightsMap: Record<string, number> = {};
    for (const w of weightsRows) {
      weightsMap[w.categoryName] = w.currentWeight;
    }

    const signals = featureEngine.calculate15Categories({
      symbol,
      candles,
      book,
      funding,
      oi,
    });

    const regime = featureEngine.detectRegime(candles);

    // Generate exactly 100 combinations
    const variations100 = combinationEngine.generate100Combinations(
      symbol,
      signals,
      regime,
      weightsMap,
      9.4
    );

    // Count distributions
    const candidatesCount = variations100.filter((c) => c.status === "candidate").length;
    const promisingCount = variations100.filter((c) => c.status === "promising").length;
    const rejectedCount = variations100.filter((c) => c.status === "rejected").length;

    // Пользовательские фильтры потенциальных сигналов
    const filters = await loadFilters();
    const withFlags = variations100.map((c) => ({ ...c, passes: comboPasses(filters, c) }));
    const passCount = withFlags.filter((c) => c.passes).length;

    return NextResponse.json({
      success: true,
      symbol,
      regime,
      totalCount: variations100.length,
      stats: {
        promisingCount,
        candidatesCount,
        rejectedCount,
        topScore: variations100[0]?.earlyValueScore || 0,
        avgScore: (variations100.reduce((acc, c) => acc + c.earlyValueScore, 0) / variations100.length).toFixed(1),
      },
      filters,
      passCount,
      combinations: withFlags,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate combinations";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
