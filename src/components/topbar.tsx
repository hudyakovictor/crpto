"use client";

import React, { useEffect, useState } from "react";
import { Eraser, Play, Radio, Settings2 } from "lucide-react";
import { Kbd, Pill, Tip, TipRow } from "./ui";
import { fmtCountdown } from "@/lib/format";
import type { StatusResponse } from "@/lib/ui-types";
import { REGIME_RU } from "@/lib/format";

function useUtcClock() {
  const [now, setNow] = useState("--:--:--");
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(
        `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Topbar({
  title,
  subtitle,
  status,
  running,
  onRun,
  onOpenSettings,
  onClearHistory,
  countdown,
}: {
  title: string;
  subtitle: string;
  status: StatusResponse | null;
  running: boolean;
  onRun: () => void;
  onOpenSettings: () => void;
  onClearHistory: () => void;
  countdown: number;
}) {
  const clock = useUtcClock();
  const isLive = status?.isLive;
  const regime = status?.latestRegime ? REGIME_RU[status.latestRegime] ?? status.latestRegime : null;
  const latency = status?.latestLatencyMs;

  return (
    <header className="sticky top-0 z-30 flex h-[64px] items-center gap-3 border-b border-border bg-[rgba(6,9,15,0.88)] px-4 backdrop-blur-md">
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 items-center justify-center rounded-md border border-[rgba(91,141,238,0.45)] bg-accent-dim">
          <span className="num text-[14px] font-bold text-accent">Q</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-wide text-text-1">OKX QUANT LAB</span>
          <span className="text-[14px] text-text-3">/ {title}</span>
        </div>
      </div>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Status pills */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        <Pill tone={isLive === false ? "warn" : "bull"} dot>
          {isLive === false ? "SYNTH" : "LIVE · OKX"}
        </Pill>
        {regime && <Pill tone="info">{regime}</Pill>}
        {typeof latency === "number" && (
          <Tip
            label={
              <div>
                <TipRow k="Латентность цикла" v={`${latency} ms`} tone={latency < 1500 ? "bull" : "warn"} />
                <TipRow k="Источник" v={isLive ? "OKX REST v5" : "Synthetic fallback"} />
                <TipRow k="Качество данных" v={status?.dataQuality ?? "—"} />
              </div>
            }
          >
            <span>
              <Pill tone={latency < 1500 ? "neutral" : "warn"}>
                <span className="num">{latency} ms</span>
              </Pill>
            </span>
          </Tip>
        )}
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-3">
        <Tip
          align="end"
          label={
            <div>
              <TipRow k="Следующий авто-цикл" v={fmtCountdown(countdown)} />
              <TipRow k="Интервал планировщика" v="15 минут" />
              <TipRow k="Прогнозов за цикл" v="до 2 (EVS ≥ 60)" />
            </div>
          }
        >
          <div className="flex items-center gap-1.5 text-text-3">
            <Radio className="size-3.5" strokeWidth={1.8} />
            <span className="num text-[14px]">{fmtCountdown(countdown)}</span>
          </div>
        </Tip>
        <span className="num text-[14px] text-text-3">{clock} UTC</span>
        <button
          onClick={onClearHistory}
          aria-label="Очистить всю историю исследований"
          title="Очистить всю историю исследований"
          className="hoverable pressable flex size-8 items-center justify-center rounded-md border border-[rgba(245,101,101,0.35)] bg-bear-dim text-bear hover:bg-bear hover:text-white"
        >
          <Eraser className="size-4" strokeWidth={1.9} />
        </button>
        <button
          onClick={onOpenSettings}
          aria-label="Настройки и фильтры сигналов"
          className="hoverable pressable flex size-8 items-center justify-center rounded-md border border-border-strong bg-surface2 text-text-2 hover:text-text-1"
        >
          <Settings2 className="size-4" strokeWidth={1.9} />
        </button>
        <button
          onClick={onRun}
          disabled={running}
          className="hoverable pressable flex h-8 items-center gap-2 rounded-md border border-[rgba(91,141,238,0.5)] bg-accent px-3 text-[14px] font-semibold text-white hover:bg-[#6d9bf3] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? (
            <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Play className="size-3.5" fill="currentColor" strokeWidth={0} />
          )}
          {running ? "Цикл выполняется…" : "Запустить цикл"}
          {!running && <Kbd>R</Kbd>}
        </button>
      </div>
    </header>
  );
}
