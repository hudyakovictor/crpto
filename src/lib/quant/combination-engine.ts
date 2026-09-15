import {
  CategoryKey,
  NormalizedSignal,
  EarlyValueBreakdown,
  GeneratedCombination,
  MarketRegime,
  CATEGORY_KEYS,
  CombinationStatus,
  SignalDirection,
  MacroRegime,
  toMacroRegime,
} from "../types";

export const REGIME_WEIGHT_DELTAS: Record<MarketRegime, number> = {
  TRENDING_BULL: 0.1,
  TRENDING_BEAR: -0.1,
  RANGING: 0.0,
  VOLATILE: 0.0,
  HIGH_VOLATILITY_CHOP: -0.15,
  LOW_VOLATILITY_SQUEEZE: 0.05,
  LIQUIDITY_CRUNCH: -0.05,
  NEUTRAL_CONSOLIDATION: 0.0,
};

export class CombinationEngine {
  /**
   * Generates 100 deterministic combinatorial variations across the 15 signal categories.
   */
  generate100Combinations(
    symbol: string,
    signals: Record<CategoryKey, NormalizedSignal>,
    regime: MarketRegime,
    categoryWeights: Record<string, number> = {},
    dataQualityScore = 9.2
  ): GeneratedCombination[] {
    const combinations: GeneratedCombination[] = [];

    // Distinct category groups for structured exploration:
    const microCats: CategoryKey[] = ["order_flow", "order_book_microstructure", "liquidations"];
    const macroCats: CategoryKey[] = ["cross_asset_relationships", "market_breadth_rotation", "derivatives_positioning"];
    const priceVolCats: CategoryKey[] = ["price_returns", "volume_liquidity", "volatility_regime"];
    const flowContextCats: CategoryKey[] = ["stablecoin_flow_proxies", "on_chain_activity", "sentiment_attention"];
    const timeAnomalyCats: CategoryKey[] = ["time_calendar_session", "anomaly_novelty", "cross_exchange_dispersion"];

    // Parameters grids
    const operators: ("AND" | "OR" | "WEIGHTED" | "VETO")[] = ["WEIGHTED", "AND", "OR", "VETO"];
    const thresholds = [0.25, 0.40, 0.60];
    const lookbacks = [7, 14, 21, 50];

    let seedCounter = 1;

    // 1. Generate Pairwise Combinations (30 variants)
    for (let i = 0; i < CATEGORY_KEYS.length - 1; i++) {
      if (combinations.length >= 30) break;
      for (let j = i + 1; j < CATEGORY_KEYS.length; j++) {
        if (combinations.length >= 30) break;
        const c1 = CATEGORY_KEYS[i];
        const c2 = CATEGORY_KEYS[j];
        const op = operators[(i + j) % operators.length];
        const thresh = thresholds[(i + j) % thresholds.length];
        const lookback = lookbacks[(i + j) % lookbacks.length];

        const combo = this.evaluateCombination(
          `C2-${symbol}-${String(seedCounter++).padStart(3, "0")}`,
          [c1, c2],
          op,
          lookback,
          thresh,
          signals,
          regime,
          categoryWeights,
          dataQualityScore
        );
        combinations.push(combo);
      }
    }

    // 2. Generate Triplet Combinations (40 variants)
    for (let i = 0; i < priceVolCats.length; i++) {
      if (combinations.length >= 70) break;
      for (let j = 0; j < microCats.length; j++) {
        if (combinations.length >= 70) break;
        for (let k = 0; k < macroCats.length; k++) {
          if (combinations.length >= 70) break;
          const c1 = priceVolCats[i];
          const c2 = microCats[j];
          const c3 = macroCats[k];
          const op = operators[(i + j + k) % operators.length];
          const thresh = thresholds[(i + k) % thresholds.length];
          const lookback = lookbacks[(j + k) % lookbacks.length];

          const combo = this.evaluateCombination(
            `C3-${symbol}-${String(seedCounter++).padStart(3, "0")}`,
            [c1, c2, c3],
            op,
            lookback,
            thresh,
            signals,
            regime,
            categoryWeights,
            dataQualityScore
          );
          combinations.push(combo);
        }
      }
    }

    // 3. Generate Quadruple & Quintuple Confluence Combinations (20 variants)
    const quadBases: CategoryKey[][] = [
      ["price_returns", "volume_liquidity", "derivatives_positioning", "order_flow"],
      ["price_returns", "volatility_regime", "liquidations", "anomaly_novelty"],
      ["volume_liquidity", "order_book_microstructure", "derivatives_positioning", "time_calendar_session"],
      ["cross_asset_relationships", "market_breadth_rotation", "price_returns", "order_flow"],
      ["stablecoin_flow_proxies", "on_chain_activity", "sentiment_attention", "liquidations"],
      ["price_returns", "volume_liquidity", "volatility_regime", "order_flow", "anomaly_novelty"],
      ["derivatives_positioning", "liquidations", "cross_exchange_dispersion", "time_calendar_session", "order_flow"],
      ["price_returns", "order_book_microstructure", "market_breadth_rotation", "cross_asset_relationships", "sentiment_attention"],
      ["volatility_regime", "stablecoin_flow_proxies", "on_chain_activity", "anomaly_novelty", "derivatives_positioning"],
      ["price_returns", "liquidations", "order_flow", "order_book_microstructure", "volume_liquidity"],
    ];

    for (let idx = 0; idx < quadBases.length; idx++) {
      for (const op of ["WEIGHTED", "AND"] as const) {
        if (combinations.length >= 90) break;
        const cats = quadBases[idx];
        const thresh = 0.35 + (idx % 3) * 0.1;
        const lookback = 14;

        const combo = this.evaluateCombination(
          `C45-${symbol}-${String(seedCounter++).padStart(3, "0")}`,
          cats,
          op,
          lookback,
          thresh,
          signals,
          regime,
          categoryWeights,
          dataQualityScore
        );
        combinations.push(combo);
      }
    }

    // 4. Generate Regime-Conditional Veto & Squeeze Combinations (10 variants to reach 100)
    while (combinations.length < 100) {
      const idx = combinations.length;
      const cats: CategoryKey[] = [
        "price_returns",
        "derivatives_positioning",
        "liquidations",
        "anomaly_novelty",
      ];
      const op: "VETO" | "WEIGHTED" = idx % 2 === 0 ? "VETO" : "WEIGHTED";
      const thresh = 0.3 + (idx % 4) * 0.1;

      const combo = this.evaluateCombination(
        `CR-${symbol}-${String(seedCounter++).padStart(3, "0")}`,
        cats,
        op,
        21,
        thresh,
        signals,
        regime,
        categoryWeights,
        dataQualityScore
      );
      combinations.push(combo);
    }

    // Sort by Early Value Score descending
    combinations.sort((a, b) => b.earlyValueScore - a.earlyValueScore);

    return combinations.slice(0, 100);
  }

  private evaluateCombination(
    code: string,
    categories: CategoryKey[],
    operator: "AND" | "OR" | "WEIGHTED" | "VETO",
    lookback: number,
    threshold: number,
    signals: Record<CategoryKey, NormalizedSignal>,
    regime: MarketRegime,
    learnedWeights: Record<string, number>,
    dataQualityBase: number
  ): GeneratedCombination {
    const includedSignals = categories.map((k) => signals[k]).filter(Boolean);

    // Compute composite direction & score
    let compositeScore = 0;
    let agreementCount = 0;
    let positiveCount = 0;
    let negativeCount = 0;

    for (const sig of includedSignals) {
      const baseWeight = learnedWeights[sig.category] ?? 1.0;
      const regimeDelta = REGIME_WEIGHT_DELTAS[regime] ?? 0;
      const weight = baseWeight + regimeDelta;
      compositeScore += sig.normalizedScore * weight;
      if (sig.normalizedScore > threshold) positiveCount++;
      if (sig.normalizedScore < -threshold) negativeCount++;
    }

    const totalWeight = includedSignals.reduce((acc, s) => acc + (learnedWeights[s.category] ?? 1.0), 0);
    const avgScore = totalWeight > 0 ? compositeScore / totalWeight : 0;

    let targetDirection: SignalDirection = "NEUTRAL";

    if (operator === "AND") {
      if (positiveCount === categories.length) targetDirection = "UP";
      else if (negativeCount === categories.length) targetDirection = "DOWN";
      else targetDirection = "NEUTRAL";
    } else if (operator === "OR") {
      if (positiveCount >= Math.ceil(categories.length / 2)) targetDirection = "UP";
      else if (negativeCount >= Math.ceil(categories.length / 2)) targetDirection = "DOWN";
      else targetDirection = "NEUTRAL";
    } else if (operator === "VETO") {
      // Veto logic: if derivatives positioning or liquidations strongly opposes momentum, veto
      const derivSig = signals.derivatives_positioning?.normalizedScore || 0;
      const priceSig = signals.price_returns?.normalizedScore || 0;
      if (priceSig > threshold && derivSig < -threshold) {
        targetDirection = "NEUTRAL"; // Crowded long squeeze risk
      } else if (avgScore > threshold) {
        targetDirection = "UP";
      } else if (avgScore < -threshold) {
        targetDirection = "DOWN";
      }
    } else {
      // WEIGHTED
      if (avgScore > threshold) targetDirection = "UP";
      else if (avgScore < -threshold) targetDirection = "DOWN";
      else targetDirection = "NEUTRAL";
    }

    agreementCount = Math.max(positiveCount, negativeCount);

// Calculate the 7 Early Value Score components:
// 1. Novelty (0 - 20)
    const anomalySig = signals.anomaly_novelty?.normalizedScore ?? 0;
    const novelty = Math.min(20, Math.max(2, Math.round(Math.abs(anomalySig) * 15 + (categories.length > 3 ? 5 : 2))));

    // 2. Cross-Category Agreement (0 - 20)
    const agreementRatio = categories.length > 0 ? agreementCount / categories.length : 0;
    const crossAgreement = Math.min(20, Math.round(agreementRatio * 20));

    // 3. Historical Support (0 - 20)
    const minSupport = Math.min(...includedSignals.map((s) => s.supportCount || 10));
    const historicalSupport = Math.min(20, Math.round(Math.min(minSupport / 2, 20)));

    // 4. Effect Stability (0 - 15)
    const macroRegime = toMacroRegime(regime);
    const isStableRegime = macroRegime === "BULLISH" || macroRegime === "BEARISH";
    const effectStability = isStableRegime ? 12 : 7;

    // 5. Coverage & Liquidity (0 - 10)
    const avgConfidence = includedSignals.reduce((acc, s) => acc + s.confidence, 0) / Math.max(1, includedSignals.length);
    const coverageLiquidity = Math.min(10, Math.round(avgConfidence * 10));

    // 6. Data Quality (0 - 10)
    const avgMissing = includedSignals.reduce((acc, s) => acc + s.missingness, 0) / Math.max(1, includedSignals.length);
    const dataQuality = Math.min(10, Math.max(1, Math.round((dataQualityBase / 10) * (1 - avgMissing) * 10)));

    // 7. Testability (0 - 5)
    const testability = targetDirection !== "NEUTRAL" ? 5 : 2;

    const totalEarlyValue = novelty + crossAgreement + historicalSupport + effectStability + coverageLiquidity + dataQuality + testability;

    // Determine status
    let status: CombinationStatus = "candidate";
    if (totalEarlyValue >= 75 && agreementRatio >= 0.75) {
      status = "promising";
    } else if (totalEarlyValue < 40 || targetDirection === "NEUTRAL") {
      status = "rejected";
    }

    // Build human-readable expression tree
    const exprCats = categories.map((c) => `${c}[${(signals[c]?.normalizedScore ?? 0).toFixed(2)}]`).join(` ${operator} `);
    const expression = `(${exprCats}) | LB=${lookback} TH=±${threshold.toFixed(2)} REGIME=${regime}`;

    const catLabels = categories.map((c) => c.replace(/_/g, " ").toUpperCase()).join(" + ");
    const name = `${operator}: ${catLabels}`;

    const breakdown: EarlyValueBreakdown = {
      novelty,
      crossAgreement,
      historicalSupport,
      effectStability,
      coverageLiquidity,
      dataQuality,
      testability,
      totalScore: totalEarlyValue,
    };

    return {
      code,
      name,
      categories,
      operator,
      expression,
      parameters: {
        lookback,
        threshold,
        regimeFilter: regime,
        weights: learnedWeights,
      },
      earlyValueScore: totalEarlyValue,
      breakdown,
      sampleSize: minSupport,
      status,
      targetDirection,
      compositeScore: avgScore,
    };
  }
}

export const combinationEngine = new CombinationEngine();
