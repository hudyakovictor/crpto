import { createHash } from "crypto";
import { GeneratedCombination, SignalDirection } from "../types";

export interface HypothesisDraft {
  code: string;
  asset: string;
  venue: string;
  timeframe: string;
  direction: SignalDirection;
  horizonMinutes: number;
  entryPrice: number;
  targetPrice: number;
  invalidationPrice: number;
  expectedMechanism: string;
  categories: string[];
  exactFormula: string;
  parameterSetId: string;
  dataVersion: string;
  scoreComponents: Record<string, number>;
  uncertainty: number;
}

export interface ForecastDraft {
  asset: string;
  direction: SignalDirection;
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
  checksum: string;
}

export class HypothesisEngine {
  /**
   * Generates a structured falsifiable hypothesis from a top combination.
   */
  createHypothesis(
    combination: GeneratedCombination,
    asset: string,
    currentPrice: number,
    horizonMinutes = 15
  ): { hypothesis: HypothesisDraft; forecast: ForecastDraft } {
    const timestamp = Date.now();
    const salt = Math.floor(Math.random() * 9000 + 1000);
    const code = `HYP-${asset.replace("-USDT", "")}-${timestamp.toString().slice(-8)}-${salt}`;
    const direction = combination.targetDirection === "NEUTRAL" ? "RANGE" : combination.targetDirection;

    // Projected move: e.g. 0.45% for 15m horizon
    const deltaPct = 0.0045;
    let targetPrice = currentPrice;
    let invalidationPrice = currentPrice;
    let expectedMinPrice = currentPrice * (1 - deltaPct * 1.5);
    let expectedMaxPrice = currentPrice * (1 + deltaPct * 1.5);

    if (direction === "UP") {
      targetPrice = currentPrice * (1 + deltaPct);
      invalidationPrice = currentPrice * (1 - deltaPct * 0.7);
      expectedMinPrice = invalidationPrice;
      expectedMaxPrice = targetPrice * 1.002;
    } else if (direction === "DOWN") {
      targetPrice = currentPrice * (1 - deltaPct);
      invalidationPrice = currentPrice * (1 + deltaPct * 0.7);
      expectedMinPrice = targetPrice * 0.998;
      expectedMaxPrice = invalidationPrice;
    } else {
      // RANGE / VOLATILITY
      targetPrice = currentPrice * (1 + deltaPct * 0.5);
      invalidationPrice = currentPrice * (1 - deltaPct * 0.5);
      expectedMinPrice = currentPrice * (1 - deltaPct * 0.8);
      expectedMaxPrice = currentPrice * (1 + deltaPct * 0.8);
    }

    const categoriesList = combination.categories.map((c) => c.replace(/_/g, " "));
    const expectedMechanism = `Confluence of [${categoriesList.join(", ")}] indicating ${direction} pressure under regime ${combination.parameters.regimeFilter || "NORMAL"}. Early Value Score: ${combination.earlyValueScore}/100.`;

    const hypothesis: HypothesisDraft = {
      code,
      asset,
      venue: "OKX",
      timeframe: "15m",
      direction,
      horizonMinutes,
      entryPrice: currentPrice,
      targetPrice,
      invalidationPrice,
      expectedMechanism,
      categories: combination.categories,
      exactFormula: combination.expression,
      parameterSetId: `grid-lb${combination.parameters.lookback}-th${combination.parameters.threshold}`,
      dataVersion: "okx-rest-v5",
      scoreComponents: {
        novelty: combination.breakdown.novelty,
        crossAgreement: combination.breakdown.crossAgreement,
        historicalSupport: combination.breakdown.historicalSupport,
        stability: combination.breakdown.effectStability,
        liquidity: combination.breakdown.coverageLiquidity,
        quality: combination.breakdown.dataQuality,
        testability: combination.breakdown.testability,
        total: combination.earlyValueScore,
      },
      uncertainty: Math.max(0.15, (100 - combination.earlyValueScore) / 100),
    };

    const fixedAt = new Date();
    const resolveAt = new Date(fixedAt.getTime() + horizonMinutes * 60 * 1000);

    const targetCondition = direction === "UP" 
      ? `price >= ${targetPrice.toFixed(2)} before ${resolveAt.toISOString()}`
      : direction === "DOWN"
      ? `price <= ${targetPrice.toFixed(2)} before ${resolveAt.toISOString()}`
      : `price within [${expectedMinPrice.toFixed(2)}, ${expectedMaxPrice.toFixed(2)}]`;

    const invalidationCondition = direction === "UP"
      ? `price <= ${invalidationPrice.toFixed(2)}`
      : direction === "DOWN"
      ? `price >= ${invalidationPrice.toFixed(2)}`
      : `price outside [${expectedMinPrice.toFixed(2)}, ${expectedMaxPrice.toFixed(2)}]`;

    // SHA-256 Checksum for cryptographic immutability
    const rawPayload = JSON.stringify({
      code,
      asset,
      entryPrice: currentPrice,
      targetPrice,
      invalidationPrice,
      direction,
      fixedAt: fixedAt.toISOString(),
      formula: combination.expression,
    });
    const checksum = createHash("sha256").update(rawPayload).digest("hex");

    const forecast: ForecastDraft = {
      asset,
      direction,
      horizonMinutes,
      fixedAt,
      resolveAt,
      entryPrice: currentPrice,
      expectedMinPrice,
      expectedMaxPrice,
      targetCondition,
      invalidationCondition,
      costsBps: 8.0, // standard taker fee 0.05% + maker/taker blend
      slippageBps: 3.0,
      fundingDragBps: 1.0,
      checksum,
    };

    return { hypothesis, forecast };
  }
}

export const hypothesisEngine = new HypothesisEngine();
