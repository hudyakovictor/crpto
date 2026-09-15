"use client";

import React, { useId, useMemo } from "react";

/* ================= Sparkline (24 closes) ================= */

export function Sparkline({
  data,
  width = 220,
  height = 44,
  className = "",
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const gid = useId().replace(/[:]/g, "");
  const { points, area, trend, last } = useMemo(() => {
    if (!data || data.length < 2) return { points: "", area: "", trend: 0, last: null as null | { x: number; y: number } };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const stepX = width / (data.length - 1);
    const pts = data.map((v, i) => {
      const x = i * stepX;
      const y = height - 3 - ((v - min) / span) * (height - 8);
      return [x, y] as const;
    });
    const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaPath = `${line} L${width},${height} L0,${height} Z`;
    const lastPt = pts[pts.length - 1];
    return {
      points: line,
      area: areaPath,
      trend: data[data.length - 1] - data[0],
      last: { x: lastPt[0], y: lastPt[1] },
    };
  }, [data, width, height]);

  if (!points) return <div className="skeleton w-full" style={{ height }} />;

  const color = trend > 0 ? "var(--green)" : trend < 0 ? "var(--red)" : "var(--blue)";
  const fill = trend > 0 ? "rgba(34,211,160,0.13)" : trend < 0 ? "rgba(245,101,101,0.13)" : "rgba(96,165,250,0.13)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={`sg-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${gid})`} />
      <path d={points} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      {last && <circle cx={last.x} cy={last.y} r="2" fill={color} />}
    </svg>
  );
}

/* ================= Mini candle strip (from closes) ================= */

export function CandleStrip({ data, width = 120, height = 28 }: { data: number[]; width?: number; height?: number }) {
  const candles = useMemo(() => {
    if (!data || data.length < 3) return [];
    const out: { x: number; up: boolean; top: number; h: number; wy: number; wh: number }[] = [];
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const n = data.length - 1;
    const cw = width / n;
    for (let i = 1; i < data.length; i++) {
      const o = data[i - 1];
      const c = data[i];
      const up = c >= o;
      const yO = height - 2 - ((o - min) / span) * (height - 6);
      const yC = height - 2 - ((c - min) / span) * (height - 6);
      out.push({
        x: (i - 1) * cw,
        up,
        top: Math.min(yO, yC),
        h: Math.max(1.5, Math.abs(yC - yO)),
        wy: yC,
        wh: 1,
      });
    }
    return out;
  }, [data, width, height]);

  if (candles.length === 0) return null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden>
      {candles.map((cndl, i) => (
        <rect
          key={i}
          x={cndl.x + 0.5}
          y={cndl.top}
          width={Math.max(1.5, width / candles.length - 1.5)}
          height={cndl.h}
          rx={0.5}
          fill={cndl.up ? "var(--green)" : "var(--red)"}
          opacity={0.85}
        />
      ))}
    </svg>
  );
}

/* ================= Equity curve ================= */

export function EquityCurve({
  points,
  goalUsd,
  width = 640,
  height = 220,
}: {
  points: { t: string; cumPnlUsd: number }[];
  goalUsd: number;
  width?: number;
  height?: number;
}) {
  const gid = useId().replace(/[:]/g, "");
  const model = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.cumPnlUsd);
    const minV = Math.min(0, ...values);
    const maxV = Math.max(...values, 1);
    // Show goal line only when it is reasonably inside the value range;
    // otherwise the path would be squashed against the x-axis.
    const showGoal = goalUsd <= maxV * 1.35;
    const min = minV - (maxV - minV) * 0.04;
    const max = showGoal ? Math.max(goalUsd * 1.04, maxV * 1.06) : maxV * 1.08;
    const span = max - min || 1;
    const padL = 8;
    const padR = 64;
    const padT = 12;
    const padB = 18;
    const iw = width - padL - padR;
    const ih = height - padT - padB;
    const pts = points.map((p, i) => {
      const x = padL + (i / (points.length - 1)) * iw;
      const y = padT + (1 - (p.cumPnlUsd - min) / span) * ih;
      return [x, y] as const;
    });
    const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${line} L${pts[pts.length - 1][0]},${height - padB} L${pts[0][0]},${height - padB} Z`;
    const zeroY = padT + (1 - (0 - min) / span) * ih;
    const goalY = padT + (1 - (goalUsd - min) / span) * ih;
    const lastV = values[values.length - 1];
    // max drawdown segment
    let peak = -Infinity;
    let ddStart = 0;
    let ddEnd = 0;
    let maxDd = 0;
    let curPeakIdx = 0;
    values.forEach((v, i) => {
      if (v > peak) {
        peak = v;
        curPeakIdx = i;
      }
      const dd = peak - v;
      if (dd > maxDd) {
        maxDd = dd;
        ddStart = curPeakIdx;
        ddEnd = i;
      }
    });
    return {
      line,
      area,
      zeroY,
      goalY: showGoal ? goalY : null,
      goalRatio: goalUsd / maxV,
      last: pts[pts.length - 1],
      lastV,
      up: lastV >= 0,
      ddRect:
        maxDd > 0
          ? { x: pts[ddStart][0], w: Math.max(2, pts[ddEnd][0] - pts[ddStart][0]) }
          : null,
      padT,
      ih,
    };
  }, [points, goalUsd, width, height]);

  if (!model) {
    return <div className="skeleton w-full" style={{ height }} />;
  }

  const stroke = model.up ? "var(--green)" : "var(--red)";
  const fillTop = model.up ? "rgba(34,211,160,0.14)" : "rgba(245,101,101,0.14)";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`eq-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillTop} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>

      {/* drawdown highlight */}
      {model.ddRect && (
        <rect
          x={model.ddRect.x}
          y={model.padT}
          width={model.ddRect.w}
          height={model.ih}
          fill="rgba(245,101,101,0.06)"
        />
      )}

      {/* zero line */}
      <line x1="8" x2={width - 64} y1={model.zeroY} y2={model.zeroY} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 4" strokeWidth="1" />
      {/* goal line (only when inside value range) */}
      {model.goalY !== null ? (
        <>
          <line x1="8" x2={width - 64} y1={model.goalY} y2={model.goalY} stroke="rgba(91,141,238,0.55)" strokeDasharray="5 4" strokeWidth="1" />
          <text x={width - 6} y={model.goalY + 3} textAnchor="end" fontSize="10" fill="var(--accent)" fontFamily="var(--font-mono)">
            ЦЕЛЬ ${goalUsd.toLocaleString("en-US")}
          </text>
        </>
      ) : (
        <text x={width - 6} y={model.padT + 8} textAnchor="end" fontSize="10" fill="var(--accent)" fontFamily="var(--font-mono)">
          Цель ${goalUsd.toLocaleString("en-US")} · вне шкалы ×{model.goalRatio.toFixed(1)}
        </text>
      )}
      <text x={width - 6} y={model.zeroY + 3} textAnchor="end" fontSize="10" fill="var(--text-3)" fontFamily="var(--font-mono)">
        $0
      </text>

      <path d={model.area} fill={`url(#eq-${gid})`} />
      <path d={model.line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={model.last[0]} cy={model.last[1]} r="3" fill={stroke} stroke="var(--bg)" strokeWidth="1.5" />
      <text
        x={width - 6}
        y={model.last[1] + 3}
        textAnchor="end"
        fontSize="10"
        fontWeight="600"
        fill={stroke}
        fontFamily="var(--font-mono)"
      >
        {model.lastV >= 0 ? "+" : "−"}${Math.abs(model.lastV).toLocaleString("en-US", { maximumFractionDigits: 0 })}
      </text>
    </svg>
  );
}

/* ================= Calibration bars (learning view) ================= */

export function CalibrationChart({
  bins,
  height = 120,
}: {
  bins: { bin: string; predictedProb: number; actualHitRate: number; count: number }[];
  height?: number;
}) {
  if (!bins.length) return null;
  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {bins.map((b) => {
        const pPct = b.predictedProb * 100;
        const aPct = b.actualHitRate * 100;
        const gap = Math.abs(pPct - aPct);
        return (
          <div key={b.bin} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-full w-full items-end justify-center gap-1">
              <div
                className="w-3.5 rounded-t-[2px] bg-[rgba(96,165,250,0.45)]"
                style={{ height: `${pPct}%` }}
                title={`Прогноз ${pPct.toFixed(0)}%`}
              />
              <div
                className="w-3.5 rounded-t-[2px]"
                style={{
                  height: `${aPct}%`,
                  background: gap <= 5 ? "rgba(34,211,160,0.75)" : "rgba(251,191,36,0.75)",
                }}
                title={`Факт ${aPct.toFixed(0)}%`}
              />
            </div>
            <div className="num text-[13px] text-text-3">{b.bin}</div>
            <div className="num text-[13px] text-text-3">n={b.count}</div>
          </div>
        );
      })}
    </div>
  );
}
