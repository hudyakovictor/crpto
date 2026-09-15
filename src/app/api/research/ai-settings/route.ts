import { NextResponse } from "next/server";
import { loadAiSettingsPublic, saveAiSettings } from "@/lib/ai/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { providers, updatedAt } = await loadAiSettingsPublic();
    return NextResponse.json({ success: true, providers, updatedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load AI settings";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: "Некорректный JSON в теле запроса" }, { status: 400 });
    }
    const { providers } = await saveAiSettings((body ?? {}) as Parameters<typeof saveAiSettings>[0]);
    return NextResponse.json({
      success: true,
      providers,
      message: "Настройки ИИ сохранены — применяются к следующим анализам",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save AI settings";
    const status = /Нельзя выключить|должен быть/.test(message) ? 400 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
