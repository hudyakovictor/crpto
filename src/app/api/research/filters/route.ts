import { NextResponse } from "next/server";
import { ALL_DIRECTIONS, ALL_OPERATORS, ALL_REGIMES, loadFiltersWithMeta, saveFilters } from "@/lib/filters";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const filters = await loadFiltersWithMeta();
    return NextResponse.json({
      success: true,
      filters,
      options: { operators: ALL_OPERATORS, directions: ALL_DIRECTIONS, regimes: ALL_REGIMES },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load filters";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Parameters<typeof saveFilters>[0];
    const filters = await saveFilters(body);
    return NextResponse.json({
      success: true,
      filters,
      message: "Фильтры сохранены — применяются к новым циклам и к списку комбинаций",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save filters";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
