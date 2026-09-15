import { NextResponse } from "next/server";
import { okxClient } from "@/lib/okx/okx-client";

export const dynamic = "force-dynamic";

/** Живые котировки OKX для бегущей строки — лёгкий эндпоинт, poll каждые 10 секунд. */
export async function GET() {
  const started = Date.now();
  try {
    const { tickers, isLive, latencyMs } = await okxClient.getTickers();
    return NextResponse.json({
      success: true,
      isLive,
      latencyMs: latencyMs || Date.now() - started,
      updatedAt: new Date().toISOString(),
      tickers: tickers.map((t) => ({
        symbol: t.instId,
        base: t.instId.split("-")[0],
        last: t.last,
        change24h: t.open24h > 0 ? ((t.last - t.open24h) / t.open24h) * 100 : 0,
        high24h: t.high24h,
        low24h: t.low24h,
        vol24h: t.vol24h,
        spreadBps: t.bidPx > 0 && t.askPx > 0 ? ((t.askPx - t.bidPx) / t.bidPx) * 10000 : 0,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OKX tickers failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
