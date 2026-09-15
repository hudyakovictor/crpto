import { NextResponse } from "next/server";
import { db } from "@/db";
import { learningWeights } from "@/db/schema";
import { sql } from "drizzle-orm";
import { learningLoop } from "@/lib/quant/learning-loop";

export const dynamic = "force-dynamic";

/** Полная очистка исследовательской истории. Фильтры и активы сохраняются. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { confirm?: boolean };
    if (body.confirm !== true) {
      return NextResponse.json(
        { success: false, error: "Требуется подтверждение: { confirm: true }" },
        { status: 400 }
      );
    }

    await db.execute(
      sql`TRUNCATE TABLE ai_analyses, forecasts, hypotheses, combinations, signal_features, experiment_runs, data_quality_logs, candles RESTART IDENTITY CASCADE`
    );
    await db.delete(learningWeights);
    await learningLoop.ensureInitialized();

    return NextResponse.json({
      success: true,
      message:
        "История очищена: прогнозы, гипотезы, комбинации, AI-разборы и журналы удалены, веса обучения сброшены к приорам 1.00. Запустите цикл (R) — лаборатория начнёт накапливать статистику заново.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reset failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
