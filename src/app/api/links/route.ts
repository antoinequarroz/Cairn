import { NextResponse } from "next/server";
import { notesLinkingTo } from "@/server/db";
import { fail } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/links?url=https://alfred.postmelo.ch/events/12: the notes that link to this page, so the
 * other app can show "Notes liées". Titles and addresses only, never the content. Reached with the
 * browser session, API_TOKEN, or SUITE_TOKEN (which opens this route and nothing else).
 */
export function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url")?.trim() ?? "";
  if (!/^https?:\/\/\S+$/.test(url) || url.length > 1000) return fail("Adresse invalide");
  const base = (process.env.APP_URL ?? new URL(req.url).origin).trim().replace(/\/+$/, "");
  const notes = notesLinkingTo(url).map((n) => ({ ...n, url: `${base}/notes/${n.id}` }));
  return NextResponse.json({ notes }, { headers: { "Cache-Control": "no-store" } });
}
