import { NextResponse } from "next/server";
import { getAutopilotState, setAutopilotEnabled } from "@/lib/quant/autopilot";
import { autonomousScheduler } from "@/lib/quant/autonomous-scheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = getAutopilotState();
  const last = autonomousScheduler.getLastRunTime();
  return NextResponse.json({
    success: true,
    autopilot: {
      enabled: s.enabled,
      cyclesCompleted: s.cyclesCompleted,
      retrainsCompleted: s.retrainsCompleted,
      lastCycleAt: s.lastCycleAt,
      lastError: s.lastError,
      nextCycleEtaSec: last ? Math.max(0, Math.round((last.getTime() + 14 * 60 * 1000 - Date.now()) / 1000)) : 0,
    },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };
  const s = setAutopilotEnabled(body.enabled !== false);
  return NextResponse.json({
    success: true,
    autopilot: { enabled: s.enabled, cyclesCompleted: s.cyclesCompleted, retrainsCompleted: s.retrainsCompleted },
    message: s.enabled
      ? "Автопилот включён: циклы 100 комбинаций и переобучение будут идти сами каждые ~14 минут"
      : "Автопилот выключен: циклы запускаются только вручную (клавиша R)",
  });
}
