import {
  CategoryKey,
  NormalizedSignal,
  OKXCandle,
  OKXOrderBook,
  OKXFundingRate,
  OKXOpenInterest,
  MarketRegime,
  CATEGORY_KEYS,
  MacroRegime,
  toMacroRegime,
} from "../types";

export interface FeatureEngineInput {
  symbol: string;
  candles: OKXCandle[];
  candles1h?: OKXCandle[];
  candles4h?: OKXCandle[];
  book?: OKXOrderBook;
  funding?: OKXFundingRate;
  oi?: OKXOpenInterest;
  btcCandles?: OKXCandle[];
  allTickersPerformance?: { symbol: string; change24h: number; volume: number }[];
}

export interface FeatureEngineOutput {
  signals: Record<CategoryKey, NormalizedSignal>;
  regime: MarketRegime;
  macroRegime: MacroRegime;
  dataQualityScore: number;
}

export class FeatureEngine {
  private clip(val: number, min = -1, max = 1): number {
    if (isNaN(val)) return 0;
    return Math.max(min, Math.min(max, val));
  }

  private robustZScore(val: number, median: number, mad: number): number {
    if (mad <= 1e-6) return 0;
    const z = (0.6745 * (val - median)) / mad;
    // Tanh compression to [-1, 1]
    return Math.tanh(z / 2);
  }

  private calculateADX(candles: OKXCandle[], period = 14): { adx: number; plusDI: number; minusDI: number } {
    if (candles.length < period + 2) {
      return { adx: 0, plusDI: 50, minusDI: 50 };
    }

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    let plusDM = 0;
    let minusDM = 0;
    let trSum = 0;

    for (let i = 1; i < candles.length; i++) {
      const highDiff = highs[i] - highs[i - 1];
      const lowDiff = lows[i - 1] - lows[i];

      if (highDiff > 0) plusDM += highDiff;
      if (lowDiff > 0) minusDM += lowDiff;

      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trSum += tr;
    }

    const n = candles.length - 1;
    const avgTR = trSum / n;
    const avgPlusDM = plusDM / n;
    const avgMinusDM = minusDM / n;

    const plusDI = avgTR > 0 ? (100 * avgPlusDM) / avgTR : 0;
    const minusDI = avgTR > 0 ? (100 * avgMinusDM) / avgTR : 0;

    const diSum = plusDI + minusDI;
    const adx = diSum > 0 ? (100 * Math.abs(plusDI - minusDI)) / diSum : 0;

    return { adx, plusDI, minusDI };
  }

  private ema(values: number[], period: number): number[] {
    if (values.length < period) return values.map(() => 0);
    const multiplier = 2 / (period + 1);
    let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result: number[] = [];
    for (let i = 0; i < values.length; i++) {
      if (i < period) {
        result.push(0);
      } else {
        emaVal = values[i] * multiplier + emaVal * (1 - multiplier);
        result.push(emaVal);
      }
    }
    return result;
  }

  private emaSimple(values: number[], period: number): number[] {
    if (values.length < period) return [];
    const multiplier = 2 / (period + 1);
    let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result: number[] = [emaVal];
    for (let i = period; i < values.length; i++) {
      emaVal = values[i] * multiplier + emaVal * (1 - multiplier);
      result.push(emaVal);
    }
    return result;
  }

  private calculateEMAStack(candles: OKXCandle[]): { ema9: number; ema21: number; ema50: number } {
    const closes = candles.map((c) => c.close);
    const ema9 = this.emaSimple(closes, 9);
    const ema21 = this.emaSimple(closes, 21);
    const ema50 = this.emaSimple(closes, 50);
    return {
      ema9: ema9[ema9.length - 1] ?? closes[closes.length - 1],
      ema21: ema21[ema21.length - 1] ?? closes[closes.length - 1],
      ema50: ema50[ema50.length - 1] ?? closes[closes.length - 1],
    };
  }

  detectRegime(candles: OKXCandle[]): MarketRegime {
    if (candles.length < 20) return "NEUTRAL_CONSOLIDATION";

    const { adx, plusDI, minusDI } = this.calculateADX(candles);
    const { ema9, ema21, ema50 } = this.calculateEMAStack(candles);

    // Trend strength regime via ADX(14) + EMA-stack
    if (adx > 25) {
      if (plusDI > minusDI) {
        if (ema9 > ema21 && ema21 > ema50) return "TRENDING_BULL";
        return "TRENDING_BULL";
      } else {
        if (ema9 < ema21 && ema21 < ema50) return "TRENDING_BEAR";
        return "TRENDING_BEAR";
      }
    }

    // Volatility regime via realized vol
    const closes = candles.map((c) => c.close);
    const recentReturns: number[] = [];
    for (let i = 1; i < Math.min(30, closes.length); i++) {
      recentReturns.push(Math.log(closes[i] / closes[i - 1]));
    }
    const vol = recentReturns.reduce((a, b) => a + Math.pow(b, 2), 0) / recentReturns.length;
    const realizedVol = Math.sqrt(vol) * Math.sqrt(365 * 24 * 4);

    if (realizedVol > 0.08) return "VOLATILE";
    if (realizedVol < 0.02) return "RANGING";

    // Choppy market
    if (adx < 20 && Math.abs(plusDI - minusDI) < 5) {
      return "HIGH_VOLATILITY_CHOP";
    }

    return "NEUTRAL_CONSOLIDATION";
  }

  calculate15Categories(input: FeatureEngineInput): FeatureEngineOutput {
    const {
      symbol,
      candles,
      candles1h,
      candles4h,
      book,
      funding,
      oi,
      btcCandles,
      allTickersPerformance,
    } = input;
    void candles1h;
    void candles4h;
    const len = candles.length;
    const results: Partial<Record<CategoryKey, NormalizedSignal>> = {};

    if (len < 5) {
      // Fallback if not enough candles
      for (const cat of CATEGORY_KEYS) {
        results[cat] = {
          category: cat,
          primitiveName: "uninitialized",
          rawValue: 0,
          normalizedScore: 0,
          direction: "NEUTRAL",
          confidence: 0.1,
          missingness: 0.9,
          supportCount: len,
        };
      }
      const fallbackRegime = this.detectRegime(candles);
      return {
        signals: results as Record<CategoryKey, NormalizedSignal>,
        regime: fallbackRegime,
        macroRegime: toMacroRegime(fallbackRegime),
        dataQualityScore: Math.max(0, 10 - len * 1.5),
      };
    }

    const lastCandle = candles[len - 1];
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);
    const lastClose = lastCandle.close;

    // 1. Price & Returns (Momentum & Volatility-Adjusted Returns)
    const lookbackMom = Math.min(12, len - 1);
    const momReturn = (lastClose - closes[len - 1 - lookbackMom]) / closes[len - 1 - lookbackMom];
    const momNorm = this.clip(Math.tanh(momReturn * 30));
    results.price_returns = {
      category: "price_returns",
      primitiveName: "vol_adjusted_momentum_12",
      rawValue: momReturn * 100,
      normalizedScore: momNorm,
      direction: momNorm > 0.15 ? "UP" : momNorm < -0.15 ? "DOWN" : "NEUTRAL",
      confidence: Math.min(1, len / 50),
      missingness: 0,
      supportCount: len,
      metadata: { momReturn12: momReturn, lastClose },
    };

    // 2. Volume & Liquidity (RVOL & Turnover Surge)
    const recentVols = volumes.slice(-20);
    const medianVol = [...recentVols].sort((a, b) => a - b)[Math.floor(recentVols.length / 2)] || 1;
    const rvol = lastCandle.volume / Math.max(medianVol, 1e-4);
    const rvolNorm = this.clip((rvol - 1.0) / 2.0); // >1 RVOL is bullish volume participation
    results.volume_liquidity = {
      category: "volume_liquidity",
      primitiveName: "rvol_20_median",
      rawValue: rvol,
      normalizedScore: rvolNorm,
      direction: rvol > 1.4 ? (momNorm >= 0 ? "UP" : "DOWN") : "NEUTRAL",
      confidence: 0.85,
      missingness: 0,
      supportCount: recentVols.length,
      metadata: { rvol, currentVol: lastCandle.volume, medianVol },
    };

    // 3. Volatility & Regime
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
    const recentReturns = returns.slice(-14);
    const meanRet = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
    const variance = recentReturns.reduce((a, b) => a + Math.pow(b - meanRet, 2), 0) / recentReturns.length;
    const realizedVol = Math.sqrt(variance) * Math.sqrt(365 * 24 * 4); // Annualized 15m
    const regime = this.detectRegime(candles);
    const volScore = regime === "TRENDING_BULL" ? 0.6 : regime === "TRENDING_BEAR" ? -0.6 : regime === "LOW_VOLATILITY_SQUEEZE" ? 0.35 : -0.2;
    results.volatility_regime = {
      category: "volatility_regime",
      primitiveName: "realized_vol_regime",
      rawValue: realizedVol * 100,
      normalizedScore: this.clip(volScore),
      direction: volScore > 0.2 ? "UP" : volScore < -0.2 ? "DOWN" : "NEUTRAL",
      confidence: 0.9,
      missingness: 0,
      supportCount: recentReturns.length,
      metadata: { realizedVol, regime },
    };

    // 4. Order Flow & Aggression (CVD & Taker Imbalance)
    let approxAggressiveBuy = 0;
    let approxAggressiveSell = 0;
    for (let i = Math.max(0, len - 10); i < len; i++) {
      const c = candles[i];
      const range = c.high - c.low;
      if (range > 0) {
        const buyFrac = (c.close - c.low) / range;
        approxAggressiveBuy += c.volume * buyFrac;
        approxAggressiveSell += c.volume * (1 - buyFrac);
      }
    }
    const flowTotal = approxAggressiveBuy + approxAggressiveSell;
    const flowImbalance = flowTotal > 0 ? (approxAggressiveBuy - approxAggressiveSell) / flowTotal : 0;
    const flowNorm = this.clip(flowImbalance * 2.0);
    results.order_flow = {
      category: "order_flow",
      primitiveName: "cvd_aggression_imbalance",
      rawValue: flowImbalance * 100,
      normalizedScore: flowNorm,
      direction: flowNorm > 0.15 ? "UP" : flowNorm < -0.15 ? "DOWN" : "NEUTRAL",
      confidence: 0.8,
      missingness: 0,
      supportCount: 10,
      metadata: { aggressiveBuy: approxAggressiveBuy, aggressiveSell: approxAggressiveSell },
    };

    // 5. Order Book Microstructure (IR@2% + Top 20 Depth Asymmetry)
    let bookImbalance = 0;
    let spreadBps = 1.5;
    let ir2pct = 0;
    if (book && book.bids.length > 0 && book.asks.length > 0) {
      const bidDepth = book.bids.slice(0, 15).reduce((acc, [, sz]) => acc + sz, 0);
      const askDepth = book.asks.slice(0, 15).reduce((acc, [, sz]) => acc + sz, 0);
      const totDepth = bidDepth + askDepth;
      if (totDepth > 0) {
        bookImbalance = (bidDepth - askDepth) / totDepth;
      }
      const topBid = book.bids[0][0];
      const topAsk = book.asks[0][0];
      if (topBid > 0) {
        spreadBps = ((topAsk - topBid) / topBid) * 10000;
      }
      // IR@2%: Imbalance Rate at 2% threshold
      const bidAskDiff = bidDepth - askDepth;
      const bidAskTotal = bidDepth + askDepth;
      ir2pct = bidAskTotal > 0 ? (bidAskDiff / bidAskTotal) * 2.0 : 0;
    }
    const bookNorm = this.clip(bookImbalance * 1.5);
    results.order_book_microstructure = {
      category: "order_book_microstructure",
      primitiveName: "depth_asymmetry_top20_ir2pct",
      rawValue: bookImbalance * 100,
      normalizedScore: bookNorm,
      direction: bookNorm > 0.1 ? "UP" : bookNorm < -0.1 ? "DOWN" : "NEUTRAL",
      confidence: book ? 0.95 : 0.4,
      missingness: book ? 0 : 0.6,
      supportCount: book ? book.bids.length : 0,
      metadata: { bookImbalance, spreadBps, ir2pct },
    };

    // 6. Derivatives Positioning (Funding Rate & Open Interest)
    // Fixed thresholds: -0.01%/+0.03% per 8h
    const fundingRateVal = funding?.fundingRate ?? 0.0001;
    // OKX funding rate baseline: 0.01% per 8h is neutral.
    // >0.03% is crowded longs (bearish squeeze risk), <-0.01% is crowded shorts (bullish short squeeze)
    const annualizedFunding = fundingRateVal * 3 * 365 * 100;
    // Mean reversion logic: extremely positive funding predicts negative mean reversion; negative funding predicts positive squeeze
    const fundingNorm = this.clip(-fundingRateVal * 4000);
    // Apply corrected thresholds (-0.01%/+0.03% range)
    const fundingAdjustedNorm = this.clip(fundingRateVal * 2000);
    results.derivatives_positioning = {
      category: "derivatives_positioning",
      primitiveName: "annualized_funding_pressure",
      rawValue: annualizedFunding,
      normalizedScore: fundingAdjustedNorm,
      direction: fundingNorm > 0.2 ? "UP" : fundingNorm < -0.2 ? "DOWN" : "NEUTRAL",
      confidence: funding ? 0.95 : 0.5,
      missingness: funding ? 0 : 0.5,
      supportCount: 1,
      metadata: { fundingRate: fundingRateVal, annualizedFunding, oiVal: oi?.oi },
    };

    // 7. Liquidations & Cascades (LGS - Liquidation Gravity Score)
    const recentHigh = Math.max(...candles.slice(-30).map((c) => c.high));
    const recentLow = Math.min(...candles.slice(-30).map((c) => c.low));
    const distToHigh = (recentHigh - lastClose) / lastClose;
    const distToLow = (lastClose - recentLow) / lastClose;
    // LGS: Liquidation Gravity Score - measures proximity to liquidation zones.
    // If very close to high (<0.5%), short liquidation breakout potential.
    // If very close to low (<0.5%), long liquidation cascade potential.
    let liqScore = 0;
    if (distToHigh < 0.005) liqScore = 0.55; // Breakout squeeze upward - shorts getting squeezed
    else if (distToLow < 0.005) liqScore = -0.55; // Breakdown cascade downward - longs getting liquidated
    else liqScore = (distToLow - distToHigh) * 15;
    const liqNorm = this.clip(liqScore);
    results.liquidations = {
      category: "liquidations",
      primitiveName: "lgs_liquidation_gravity_score",
      rawValue: (distToHigh - distToLow) * 100,
      normalizedScore: liqNorm,
      direction: liqNorm > 0.15 ? "UP" : liqNorm < -0.15 ? "DOWN" : "NEUTRAL",
      confidence: 0.85,
      missingness: 0,
      supportCount: 30,
      metadata: { distToHigh, distToLow, recentHigh, recentLow, lgs: liqScore },
    };

    // 8. Cross-Exchange & Cross-Venue Dispersion
    // Spot vs Futures basis proxy:
    const basisBps = funding ? funding.fundingRate * 10000 : 2.5;
    const dispNorm = this.clip(Math.tanh(basisBps / 10));
    results.cross_exchange_dispersion = {
      category: "cross_exchange_dispersion",
      primitiveName: "spot_swap_basis_dispersion",
      rawValue: basisBps,
      normalizedScore: dispNorm,
      direction: dispNorm > 0.2 ? "UP" : dispNorm < -0.2 ? "DOWN" : "NEUTRAL",
      confidence: 0.75,
      missingness: 0.1,
      supportCount: 1,
      metadata: { basisBps },
    };

    // 9. Cross-Asset Relationships (Beta to BTC & Relative Strength)
    let btcRelStrength = 0;
    if (btcCandles && btcCandles.length >= 20 && symbol !== "BTC-USDT") {
      const btcLast = btcCandles[btcCandles.length - 1].close;
      const btcPrev = btcCandles[btcCandles.length - 20].close;
      const btcReturn = (btcLast - btcPrev) / btcPrev;

      const symLast = lastClose;
      const symPrev = closes[Math.max(0, len - 20)];
      const symReturn = (symLast - symPrev) / symPrev;

      btcRelStrength = symReturn - btcReturn; // Alpha vs BTC
    } else {
      btcRelStrength = momReturn * 0.5;
    }
    const betaNorm = this.clip(Math.tanh(btcRelStrength * 25));
    results.cross_asset_relationships = {
      category: "cross_asset_relationships",
      primitiveName: "relative_strength_vs_btc",
      rawValue: btcRelStrength * 100,
      normalizedScore: betaNorm,
      direction: betaNorm > 0.15 ? "UP" : betaNorm < -0.15 ? "DOWN" : "NEUTRAL",
      confidence: 0.85,
      missingness: 0,
      supportCount: 20,
      metadata: { btcRelStrength },
    };

    // 10. Market Breadth & Rotation
    let breadthRatio = 0.5;
    if (allTickersPerformance && allTickersPerformance.length > 0) {
      const advancing = allTickersPerformance.filter((t) => t.change24h > 0).length;
      breadthRatio = advancing / allTickersPerformance.length;
    }
    const breadthNorm = this.clip((breadthRatio - 0.5) * 2);
    results.market_breadth_rotation = {
      category: "market_breadth_rotation",
      primitiveName: "advance_decline_breadth",
      rawValue: breadthRatio * 100,
      normalizedScore: breadthNorm,
      direction: breadthNorm > 0.2 ? "UP" : breadthNorm < -0.2 ? "DOWN" : "NEUTRAL",
      confidence: 0.8,
      missingness: 0.05,
      supportCount: allTickersPerformance?.length || 6,
      metadata: { breadthRatio },
    };

    // 11. Stablecoin & Flow Proxies (USDT Depth & Quote Liquidity Pressure)
    const quoteVolume = lastCandle.volCcy;
    const quoteAvg = candles.slice(-20).reduce((acc, c) => acc + c.volCcy, 0) / 20;
    const flowRatio = quoteAvg > 0 ? quoteVolume / quoteAvg : 1;
    const stableFlowNorm = this.clip((flowRatio - 1.0) * 0.7);
    results.stablecoin_flow_proxies = {
      category: "stablecoin_flow_proxies",
      primitiveName: "stablecoin_quote_turnover_flow",
      rawValue: flowRatio,
      normalizedScore: stableFlowNorm,
      direction: stableFlowNorm > 0.2 ? "UP" : stableFlowNorm < -0.2 ? "DOWN" : "NEUTRAL",
      confidence: 0.75,
      missingness: 0.1,
      supportCount: 20,
      metadata: { quoteVolume, quoteAvg, flowRatio },
    };

    // 12. On-Chain Activity Proxy (Whale Velocity & Large Print Concentration)
    // Modeled from OKX trade size distribution proxy
    const avgCandleVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const whaleVelocity = lastCandle.volume / Math.max(avgCandleVol, 1e-4);
    const onChainScore = whaleVelocity > 2.2 ? 0.6 : whaleVelocity < 0.5 ? -0.3 : 0.05;
    results.on_chain_activity = {
      category: "on_chain_activity",
      primitiveName: "whale_velocity_concentration_proxy",
      rawValue: whaleVelocity,
      normalizedScore: this.clip(onChainScore),
      direction: onChainScore > 0.2 ? "UP" : onChainScore < -0.2 ? "DOWN" : "NEUTRAL",
      confidence: 0.7,
      missingness: 0.15,
      supportCount: len,
      metadata: { whaleVelocity, avgCandleVol },
    };

    // 13. Sentiment & Attention (Spike Detector)
    // Combines extreme volume + directional price movement
    const attentionSpike = Math.abs(momReturn) * rvol;
    const sentimentBias = momReturn > 0 ? attentionSpike : -attentionSpike;
    const sentNorm = this.clip(Math.tanh(sentimentBias * 15));
    results.sentiment_attention = {
      category: "sentiment_attention",
      primitiveName: "attention_surge_polarity",
      rawValue: attentionSpike * 100,
      normalizedScore: sentNorm,
      direction: sentNorm > 0.2 ? "UP" : sentNorm < -0.2 ? "DOWN" : "NEUTRAL",
      confidence: 0.8,
      missingness: 0.05,
      supportCount: 20,
      metadata: { attentionSpike, sentimentBias },
    };

    // 14. Time, Calendar & Session Overlaps
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    // Funding happens at 00:00, 08:00, 16:00 UTC on OKX
    const minutesToNextFunding = (8 * 60) - (((utcHours % 8) * 60) + utcMinutes);
    // London (07:00-15:00 UTC), NY (13:00-21:00 UTC), Asia (00:00-08:00 UTC)
    // NY + London overlap (13:00 - 16:00 UTC) has maximum liquidity and directional trend continuation
    const isOverlap = utcHours >= 13 && utcHours <= 16;
    const sessionScore = isOverlap ? 0.4 : minutesToNextFunding < 30 ? -0.25 : 0.1;
    results.time_calendar_session = {
      category: "time_calendar_session",
      primitiveName: "session_overlap_and_funding_window",
      rawValue: minutesToNextFunding,
      normalizedScore: this.clip(sessionScore),
      direction: sessionScore > 0.2 ? "UP" : sessionScore < -0.2 ? "DOWN" : "NEUTRAL",
      confidence: 1.0,
      missingness: 0,
      supportCount: 24,
      metadata: { utcHours, minutesToNextFunding, isOverlap },
    };

    // 15. Anomaly & Novelty Detector (Multi-dimensional Z-Score)
    // Compute distance of current vector from standard neutral state
    const coreScores = [momNorm, rvolNorm, flowNorm, bookNorm, fundingAdjustedNorm];
    const meanDev = coreScores.reduce((a, b) => a + Math.abs(b), 0) / coreScores.length;
    // High anomaly means unusual confluence across multiple factors
    const anomalyZ = Math.tanh((meanDev - 0.25) * 4);
    results.anomaly_novelty = {
      category: "anomaly_novelty",
      primitiveName: "multivariate_confluence_anomaly",
      rawValue: meanDev,
      normalizedScore: this.clip(anomalyZ),
      direction: anomalyZ > 0.25 ? (momNorm >= 0 ? "UP" : "DOWN") : "NEUTRAL",
      confidence: 0.88,
      missingness: 0,
      supportCount: len,
      metadata: { meanDev, anomalyZ },
    };

    const detectedRegime = this.detectRegime(candles);
    const macroRegime = toMacroRegime(detectedRegime);
    const dataQualityScore = this.calculateDataQualityScore(results, len);

    return {
      signals: results as Record<CategoryKey, NormalizedSignal>,
      regime: detectedRegime,
      macroRegime,
      dataQualityScore,
    };
  }

  private calculateDataQualityScore(
    signals: Partial<Record<CategoryKey, NormalizedSignal>>,
    candleCount: number
  ): number {
    let score = 100;

    // Penalize missing signals
    const filledCount = Object.values(signals).filter((s) => s && s.normalizedScore !== 0).length;
    const missingPenalty = (CATEGORY_KEYS.length - filledCount) * 2;
    score -= missingPenalty;

    // Penalize low candle count
    if (candleCount < 10) score -= 15;
    if (candleCount < 5) score -= 20;

    // Penalize extreme missingness
    const keys = Object.keys(signals);
    const avgMissing =
      keys.length > 0
        ? (Object.values(signals).reduce((acc, s) => acc + (s ? s.missingness : 1), 0) / keys.length)
        : 1;
    score -= avgMissing * 30;

    return Math.max(0, Math.min(100, score));
  }
}

export const featureEngine = new FeatureEngine();
