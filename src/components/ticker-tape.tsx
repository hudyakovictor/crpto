"use client";

import React from "react";
import { useApi } from "./data";
import { fmtPrice } from "@/lib/format";

interface TickerRow {
  symbol: string;
  base: string;
  last: number;
  change24h: number;
  spreadBps: number;
}

interface TickersResponse {
  success: boolean;
  isLive: boolean;
  latencyMs: number;
  tickers: TickerRow[];
}

/** Живые котировки OKX — обновление каждые 10 секунд. */
export function TickerTape() {
  const { data, loading } = useApi<TickersResponse>("/api/research/tickers", 10000);

  if (loading && !data) {
    return (
      <div className="flex h-9 items-center gap-4 border-b border-border bg-surface px-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton h-4 w-24" />
        ))}
      </div>
    );
  }
  if (!data?.tickers?.length) return null;

  return (
    <div className="flex h-9 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3">
      <span className="num mr-2 shrink-0 rounded bg-surface3 px-2 py-0.5 text-[11px] font-bold tracking-wider text-text-2">
        OKX {data.isLive ? "LIVE" : "SYNTH"}
      </span>
      {data.tickers.map((t) => {
        const up = t.change24h > 0;
        const color = up ? "var(--green)" : t.change24h < 0 ? "var(--red)" : "var(--blue)";
        return (
          <div
            key={t.symbol}
            className="hoverable flex shrink-0 items-baseline gap-2 rounded-md px-2.5 py-1 hover:bg-surface2"
          >
            <span className="num text-[13px] font-bold text-text-1">{t.base}</span>
            <span className="num text-[13px] text-text-2">${fmtPrice(t.last)}</span>
            <span className="num text-[12.5px] font-semibold" style={{ color }}>
              {up ? "▲" : t.change24h < 0 ? "▼" : "•"} {Math.abs(t.change24h).toFixed(2)}%
            </span>
          </div>
        );
      })}
      <span className="num ml-auto shrink-0 pl-3 text-[11.5px] text-text-3">{data.latencyMs} ms</span>
    </div>
  );
}
