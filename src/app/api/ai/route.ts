import { NextResponse } from "next/server";
import { parseAiInput } from "@/lib/ai";
import { AiError, aiStatus, streamAnswer } from "@/server/ai";
import { body, fail } from "@/server/http";

export const dynamic = "force-dynamic";
// A long note translated or rewritten streams for many minutes. Silence from the provider is bounded
// in src/server/ai.ts; this only keeps a host that enforces a duration from cutting a healthy answer.
export const maxDuration = 800;

export function GET() {
  return NextResponse.json(aiStatus(), { headers: { "Cache-Control": "no-store" } });
}

/** Streams the answer as plain text. The prompt is built here: the browser only names an action. */
export async function POST(req: Request) {
  if (!aiStatus().ready) return fail("Aucune IA n'est configurée sur ce serveur. Voir docs/IA.md.", 503);
  const input = parseAiInput(await body(req));
  if (typeof input === "string") return fail(input);
  try {
    const stream = await streamAnswer(input, req.signal);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        // A buffering reverse proxy (nginx) would otherwise deliver the text in one piece.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    if (e instanceof AiError) return fail(e.message, 502);
    throw e;
  }
}
