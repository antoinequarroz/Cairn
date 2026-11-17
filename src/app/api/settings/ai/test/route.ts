import { NextResponse } from "next/server";
import { isProvider } from "@/lib/ai";
import { AiError, streamAnswer } from "@/server/ai";
import { body, fail } from "@/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Asks one provider a fixed, harmless question: nothing from the notes is sent. */
export async function POST(req: Request) {
  const { provider } = await body(req);
  if (!isProvider(provider)) return fail("Fournisseur inconnu");
  const started = Date.now();
  try {
    const stream = await streamAnswer({ action: "custom", text: "", instruction: "Réponds seulement : « Cairn est bien connecté. »" }, req.signal, { provider });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let answer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      if (answer.length > 500) {
        await reader.cancel();
        break;
      }
    }
    return NextResponse.json({ ok: true, answer: answer.trim().slice(0, 200), ms: Date.now() - started });
  } catch (e) {
    if (e instanceof AiError) return fail(e.message, 502);
    console.error("[ia] test", e);
    return fail("Le test a échoué : la connexion a été coupée", 502);
  }
}
