import { db } from "@/db";
import { signalFilters } from "@/db/schema";
import { eq } from "drizzle-orm";

export const ALL_OPERATORS = ["WEIGHTED", "AND", "OR", "VETO"];
export const ALL_DIRECTIONS = ["UP", "DOWN", "NEUTRAL"];
export const ALL_REGIMES = [
  "ANY",
  "TRENDING_BULL",
  "TRENDING_BEAR",
  "HIGH_VOLATILITY_CHOP",
  "LOW_VOLATILITY_SQUEEZE",
  "LIQUIDITY_CRUNCH",
  "NEUTRAL_CONSOLIDATION",
];

export interface FilterState {
  minEvs: number;
  minCategories: number;
  maxHypothesesPerCycle: number;
  operators: string[];
  directions: string[];
  regimeLock: string;
  excludedCategories: string[];
}

async function getOrCreateRow() {
  const rows = await db.select().from(signalFilters).where(eq(signalFilters.profile, "default")).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db.insert(signalFilters).values({ profile: "default" }).returning();
  return created;
}

function toState(r: {
  minEvs: number;
  minCategories: number;
  maxHypothesesPerCycle: number;
  operators: string;
  directions: string;
  regimeLock: string;
  excludedCategories: string;
}): FilterState {
  return {
    minEvs: r.minEvs,
    minCategories: r.minCategories,
    maxHypothesesPerCycle: r.maxHypothesesPerCycle,
    operators: r.operators.split(",").filter(Boolean),
    directions: r.directions.split(",").filter(Boolean),
    regimeLock: r.regimeLock,
    excludedCategories: r.excludedCategories.split(",").filter(Boolean),
  };
}

export async function loadFilters(): Promise<FilterState> {
  return toState(await getOrCreateRow());
}

export async function loadFiltersWithMeta() {
  const r = await getOrCreateRow();
  return { ...toState(r), updatedAt: r.updatedAt.toISOString() };
}

export async function saveFilters(body: Partial<FilterState>): Promise<ReturnType<typeof loadFiltersWithMeta>> {
  await getOrCreateRow();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.minEvs === "number") patch.minEvs = Math.max(10, Math.min(95, Math.round(body.minEvs)));
  if (typeof body.maxHypothesesPerCycle === "number")
    patch.maxHypothesesPerCycle = Math.max(1, Math.min(100, Math.round(body.maxHypothesesPerCycle)));
  if (typeof body.minCategories === "number")
    patch.minCategories = Math.max(1, Math.min(5, Math.round(body.minCategories)));
  if (Array.isArray(body.operators) && body.operators.length > 0)
    patch.operators = body.operators.filter((o) => ALL_OPERATORS.includes(o)).join(",");
  if (Array.isArray(body.directions) && body.directions.length > 0)
    patch.directions = body.directions.filter((d) => ALL_DIRECTIONS.includes(d)).join(",");
  if (typeof body.regimeLock === "string" && ALL_REGIMES.includes(body.regimeLock))
    patch.regimeLock = body.regimeLock;
  if (Array.isArray(body.excludedCategories))
    patch.excludedCategories = body.excludedCategories.slice(0, 15).join(",");

  const [updated] = await db
    .update(signalFilters)
    .set(patch)
    .where(eq(signalFilters.profile, "default"))
    .returning();

  return { ...toState(updated), updatedAt: updated.updatedAt.toISOString() };
}

/** Проверка комбинации против фильтров — единая логика для UI и планировщика. */
export function comboPasses(
  f: FilterState,
  combo: {
    earlyValueScore: number;
    categories: string[];
    operator: string;
    targetDirection: string;
    parameters?: { regimeFilter?: string } | unknown;
  }
): boolean {
  if (combo.earlyValueScore < f.minEvs) return false;
  if (combo.categories.length < f.minCategories) return false;
  if (!f.operators.includes(combo.operator)) return false;
  if (!f.directions.includes(combo.targetDirection)) return false;
  if (combo.categories.some((c) => f.excludedCategories.includes(c))) return false;
  const rf = (combo.parameters as { regimeFilter?: string } | undefined)?.regimeFilter;
  if (f.regimeLock !== "ANY" && rf && rf !== f.regimeLock) return false;
  return true;
}
