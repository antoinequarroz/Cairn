import { NextResponse } from "next/server";
import { deleteNote, getNote, updateNote } from "@/server/db";
import { body, fail, MAX_NOTE, MAX_TITLE, text } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const note = getNote((await params).id);
  return note ? NextResponse.json({ note }) : fail("Note introuvable", 404);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const b = await body(req);
  const title = text(b.title, MAX_TITLE);
  const content = text(b.content, MAX_NOTE);
  if (title === null || content === null || (b.encrypted !== undefined && typeof b.encrypted !== "boolean")) return fail("Note invalide");
  const note = updateNote((await params).id, { title, content, encrypted: b.encrypted as boolean | undefined });
  return note ? NextResponse.json({ note }) : fail("Note introuvable", 404);
}

export async function DELETE(_: Request, { params }: Ctx) {
  return deleteNote((await params).id) ? NextResponse.json({ ok: true }) : fail("Note introuvable", 404);
}
