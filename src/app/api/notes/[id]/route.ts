import { NextResponse } from "next/server";
import { deleteNote, getNote, updateNote } from "@/server/db";
import { body, fail, folderRef, MAX_NOTE, MAX_TITLE, text } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const note = getNote((await params).id);
  return note ? NextResponse.json({ note }) : fail("Note introuvable", 404);
}

/**
 * `ifUpdatedAt` (optional, sent by the Mac and iPhone apps): the date of the version the edit starts
 * from. When the note changed since (on another device), nothing is written and the answer is a 409
 * with the current note, so the app can ask which version to keep instead of overwriting it.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const b = await body(req);
  const id = (await params).id;
  const title = text(b.title, MAX_TITLE);
  const content = text(b.content, MAX_NOTE);
  const folderId = folderRef(b.folderId);
  if (title === null || content === null || folderId === false || (b.encrypted !== undefined && typeof b.encrypted !== "boolean") || (b.ifUpdatedAt !== undefined && typeof b.ifUpdatedAt !== "string")) return fail("Note invalide");
  if (b.ifUpdatedAt !== undefined) {
    const current = getNote(id);
    if (!current) return fail("Note introuvable", 404);
    if (current.updatedAt !== b.ifUpdatedAt) return NextResponse.json({ error: "Note modifiée ailleurs entre-temps", note: current }, { status: 409 });
  }
  const note = updateNote(id, { title, content, encrypted: b.encrypted as boolean | undefined, folderId });
  return note ? NextResponse.json({ note }) : fail("Note introuvable", 404);
}

export async function DELETE(_: Request, { params }: Ctx) {
  return deleteNote((await params).id) ? NextResponse.json({ ok: true }) : fail("Note introuvable", 404);
}
