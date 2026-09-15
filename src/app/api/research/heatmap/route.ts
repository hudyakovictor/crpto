import { NextResponse } from "next/server";
import { db } from "@/db";
import { learningWeights } from "@/db/schema";
import { okxClient, TRACKED_SYMBOLS } from "@/lib/okx/okx-client";
import { featureEngine } from "@/lib/quant/feature-engine";
import { combinationEngine } from "@/lib/quant/combination-engine";
import { CATEGORY_KEYS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PRIMARY = ["BTC-USDT", "ETH-USDT", "SOL-USDT"];

export async function GET() {
  const started = Date.now();
  try {
    const { tickers, isLive } = await okxClient.getTickers();
    const allTickersPerf = tickers.map((t) => ({
      symbol: t.instId,
      change24h: t.open24h > 0 ? ((t.last - t.open24h) / t.open24h) * 100 : 0,
      volume: t.vol24h,
    }));

    let weightsRows: { categoryName: string; currentWeight: number }[] = [];
    try {
      weightsRows = await db.select().from(learningWeights);
    } catch {
      weightsRows = [];
    }
    const weightsMap: Record<string, number> = {};
    for (const w of weightsRows) weightsMap[w.categoryName] = w.currentWeight;

    const { candles: btcCandles } = await okxClient.getCandles("BTC-USDT", "15m", 40);
    const assetResults = [];

    for (const sym of PRIMARY) {
      const { candles } = await okxClient.getCandles(sym, "15m", 40);
      const { book } = await okxClient.getOrderBook(sym, 10);
      const { funding } = await okxClient.getFundingRate(sym);
      const { oi } = await okxClient.getOpenInterest(sym);

      const signals = featureEngine.calculate15Categories({
        symbol: sym,
        candles,
        book,
        funding,
        oi,
        btcCandles,
        allTickersPerformance: allTickersPerf,
      });

      const regime = featureEngine.detectRegime(candles);
      const ticker = tickers.find((t) => t.instId === sym);
      const closes24 = candles.slice(-24).map((c) => c.close);

      // Fast in-memory top-EVS probe for the card score (BTC full run, others cheap)
      let topEvs = 0;
      let topDirection = "NEUTRAL";
      try {
        const probe = combinationEngine.generate100Combinations(sym, signals, regime, weightsMap, 9.4);
        if (probe.length > 0) {
          topEvs = probe[0].earlyValueScore;
          topDirection = probe[0].targetDirection;
        }
      } catch {
        // probe is advisory only
      }

      assetResults.push({
        symbol: sym,
        lastPrice: ticker?.last || (candles[candles.length - 1]?.close ?? 0),
        change24h: ticker?.open24h ? ((ticker.last - ticker.open24h) / ticker.open24h) * 100 : 0,
        regime,
        closes24,
        topEvs,
        topDirection,
        signals,
      });
    }

    return NextResponse.json({
      success: true,
      categories: CATEGORY_KEYS,
      tracked: TRACKED_SYMBOLS,
      isLive,
      latencyMs: Date.now() - started,
      assets: assetResults,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load heatmap";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
