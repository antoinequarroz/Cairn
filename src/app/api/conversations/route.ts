import { NextResponse } from "next/server";
import { createConversation, listConversations } from "@/server/db";
import { body, fail, folderRef, MAX_TITLE, noteIds, text } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ conversations: listConversations() });
}

export async function POST(req: Request) {
  const b = await body(req);
  const title = text(b.title, MAX_TITLE);
  const folderId = folderRef(b.folderId);
  const ids = noteIds(b.contextNoteIds);
  if (title === null || folderId === false || ids === null) return fail("Discussion invalide");
  return NextResponse.json({ conversation: createConversation({ title, folderId, contextNoteIds: ids }) }, { status: 201 });
}
