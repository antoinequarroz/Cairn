import { NextResponse } from "next/server";
import { createNote, listNotes } from "@/server/db";
import { body, fail, folderRef, MAX_NOTE, MAX_TITLE, text } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ notes: listNotes() });
}

export async function POST(req: Request) {
  const b = await body(req);
  const title = text(b.title, MAX_TITLE);
  const content = text(b.content, MAX_NOTE);
  const folderId = folderRef(b.folderId);
  if (title === null || content === null || folderId === false) return fail("Note invalide");
  return NextResponse.json({ note: createNote({ title, content, folderId }) }, { status: 201 });
}
