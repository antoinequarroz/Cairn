import { NextResponse } from "next/server";
import type { AiSettingsUpdate } from "@/lib/ai-settings";
import { aiSettingsView, updateAiSettings } from "@/server/ai-settings";
import { body, fail } from "@/server/http";

export const dynamic = "force-dynamic";

/** What is set up, never the keys themselves. */
export function GET() {
  return NextResponse.json(aiSettingsView(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const b = await body(req);
  const why = updateAiSettings({ provider: b.provider as AiSettingsUpdate["provider"], providers: b.providers as AiSettingsUpdate["providers"] });
  if (why) return fail(why);
  return NextResponse.json(aiSettingsView());
}
