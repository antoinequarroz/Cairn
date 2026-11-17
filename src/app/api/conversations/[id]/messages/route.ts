import { MAX_CHAT_MESSAGE } from "@/lib/chat";
import { ChatError, sendChatMessage } from "@/server/chat";
import { body, fail } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
// A long answer streams for minutes. Silence from the provider is bounded in src/server/ai.ts.
export const maxDuration = 800;

/**
 * Sends a message and streams the answer as plain text. The answer is saved on the server as it
 * comes, so the browser may leave: the discussion shows it when it comes back.
 */
export async function POST(req: Request, { params }: Ctx) {
  const b = await body(req);
  if (typeof b.content !== "string" || !b.content.trim()) return fail("Écris un message");
  if (b.content.length > MAX_CHAT_MESSAGE) return fail(`Message trop long (${MAX_CHAT_MESSAGE.toLocaleString("fr-CH")} caractères au plus). Mets le texte dans une note et épingle-la.`);
  try {
    const turn = await sendChatMessage((await params).id, b.content.trim());
    return new Response(turn.stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
        "X-Cairn-Message-Id": turn.assistantMessageId,
        // Header values are ASCII: the titles go URI-encoded.
        "X-Cairn-Skipped-Notes": encodeURIComponent(JSON.stringify(turn.skippedNotes)),
        ...(turn.sources ? { "X-Cairn-Sources": encodeURIComponent(JSON.stringify(turn.sources)) } : {}),
      },
    });
  } catch (e) {
    if (e instanceof ChatError) return fail(e.message, e.status);
    throw e;
  }
}
