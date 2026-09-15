import { ForecastOutcome, ErrorType, OKXCandle } from "../types";

export interface ForecastRecord {
  id: number;
  hypothesisId: number | null;
  asset: string;
  direction: string;
  horizonMinutes: number;
  fixedAt: Date;
  resolveAt: Date;
  entryPrice: number;
  expectedMinPrice: number;
  expectedMaxPrice: number;
  targetCondition: string;
  invalidationCondition: string;
  costsBps: number;
  slippageBps: number;
  fundingDragBps: number;
  status: string;
}

export interface OutcomeResolution {
  forecastId: number;
  outcome: ForecastOutcome;
  resolvedPrice: number;
  mfe: number; // %
  mae: number; // %
  realizedReturnNet: number; // %
  errorType: ErrorType;
  resolvedAt: Date;
}

export class OutcomeEvaluator {
  /**
   * Evaluates a forecast against observed candles between fixedAt and resolveAt.
   */
  evaluate(forecast: ForecastRecord, currentPrice: number, candles: OKXCandle[]): OutcomeResolution {
    const { entryPrice, direction, costsBps, slippageBps, fundingDragBps } = forecast;
    const totalCostsPct = ((costsBps + slippageBps + fundingDragBps) * 2) / 10000; // Round-trip costs in %

    // Filter candles that occurred during or after the forecast period
    const fixedTime = new Date(forecast.fixedAt).getTime();
    const resolveTime = new Date(forecast.resolveAt).getTime();

    const periodCandles = candles.filter((c) => c.timestamp >= fixedTime - 15 * 60 * 1000);

    let maxPrice = currentPrice;
    let minPrice = currentPrice;

    if (periodCandles.length > 0) {
      maxPrice = Math.max(...periodCandles.map((c) => c.high), currentPrice);
      minPrice = Math.min(...periodCandles.map((c) => c.low), currentPrice);
    } else {
      maxPrice = Math.max(entryPrice, currentPrice);
      minPrice = Math.min(entryPrice, currentPrice);
    }

    let mfe = 0;
    let mae = 0;
    let rawReturn = 0;
    let isHit = false;
    let isMiss = false;

    if (direction === "UP") {
      mfe = ((maxPrice - entryPrice) / entryPrice) * 100;
      mae = ((entryPrice - minPrice) / entryPrice) * 100;
      rawReturn = ((currentPrice - entryPrice) / entryPrice) * 100;
      // Hit if reached +0.4% or currentPrice > entryPrice with positive return after costs
      isHit = rawReturn > totalCostsPct * 100 && mfe > 0.35;
      isMiss = !isHit;
    } else if (direction === "DOWN") {
      mfe = ((entryPrice - minPrice) / entryPrice) * 100;
      mae = ((maxPrice - entryPrice) / entryPrice) * 100;
      rawReturn = ((entryPrice - currentPrice) / entryPrice) * 100;
      isHit = rawReturn > totalCostsPct * 100 && mfe > 0.35;
      isMiss = !isHit;
    } else {
      // RANGE / VOLATILITY
      const movePct = (Math.abs(currentPrice - entryPrice) / entryPrice) * 100;
      mfe = movePct;
      mae = 0;
      rawReturn = (0.3 - movePct);
      isHit = movePct <= 0.45;
      isMiss = !isHit;
    }

    const realizedReturnNet = rawReturn - (totalCostsPct * 100);

    let outcome: ForecastOutcome = isHit ? "hit" : isMiss ? "miss" : "ambiguous";
    let errorType: ErrorType = "none";

    if (outcome === "miss") {
      // Classify quantitative error type
      if (rawReturn > 0 && realizedReturnNet <= 0) {
        errorType = "cost_drag";
      } else if (mfe > 0.4 && rawReturn < -0.2) {
        errorType = "wrong_horizon"; // Hit target during life, then reversed
      } else if (rawReturn < -0.7) {
        errorType = "wrong_sign"; // Strong counter-trend move
      } else if (Math.abs(rawReturn) < 0.15) {
        errorType = "weak_signal"; // Flat market, insufficient momentum
      } else {
        errorType = "regime_mismatch";
      }
    }

    return {
      forecastId: forecast.id,
      outcome,
      resolvedPrice: currentPrice,
      mfe: Math.max(0, mfe),
      mae: Math.max(0, mae),
      realizedReturnNet,
      errorType,
      resolvedAt: new Date(),
    };
  }
}

export const outcomeEvaluator = new OutcomeEvaluator();
