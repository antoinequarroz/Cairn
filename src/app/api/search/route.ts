import { NextResponse } from "next/server";
import { getFolder } from "@/server/db";
import { search } from "@/server/search";

export const dynamic = "force-dynamic";

/** GET /api/search?q=caddy&folder=<id>&limit=30 : notes and AI discussions, best matches first. */
export function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").slice(0, 500);
  const folder = params.get("folder");
  const folderId = folder && getFolder(folder) ? folder : null;
  const limit = Number(params.get("limit")) || undefined;
  return NextResponse.json({ results: search(q, { folderId, limit }) });
}
