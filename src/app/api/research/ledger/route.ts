import { NextResponse } from "next/server";
import { db } from "@/db";
import { hypotheses, forecasts } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const hypList = await db.select().from(hypotheses).orderBy(desc(hypotheses.createdAt)).limit(50);
    const fcList = await db.select().from(forecasts).orderBy(desc(forecasts.createdAt)).limit(50);

    const joined = fcList.map((fc) => {
      const parentHyp = hypList.find((h) => h.id === fc.hypothesisId);
      return {
        ...fc,
        hypothesis: parentHyp || null,
      };
    });

    return NextResponse.json({
      success: true,
      hypotheses: hypList,
      forecasts: joined,
      totalCount: joined.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load ledger";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
