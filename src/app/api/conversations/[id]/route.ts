import { NextResponse } from "next/server";
import { stopChat } from "@/server/chat";
import { deleteConversation, getConversation, listMessages, updateConversation } from "@/server/db";
import { body, fail, folderRef, MAX_TITLE, noteIds, notesSearchRef, text } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: Ctx) {
  const id = (await params).id;
  const conversation = getConversation(id);
  return conversation ? NextResponse.json({ conversation, messages: listMessages(id) }, { headers: { "Cache-Control": "no-store" } }) : fail("Discussion introuvable", 404);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const b = await body(req);
  const title = text(b.title, MAX_TITLE);
  const folderId = folderRef(b.folderId);
  const ids = noteIds(b.contextNoteIds);
  const notesSearch = notesSearchRef(b.notesSearch);
  if (title === null || folderId === false || ids === null || notesSearch === false) return fail("Discussion invalide");
  const conversation = updateConversation((await params).id, { title, folderId, contextNoteIds: ids, notesSearch });
  return conversation ? NextResponse.json({ conversation }) : fail("Discussion introuvable", 404);
}

export async function DELETE(_: Request, { params }: Ctx) {
  const id = (await params).id;
  // An answer still being written would carry on for nothing.
  stopChat(id);
  return deleteConversation(id) ? NextResponse.json({ ok: true }) : fail("Discussion introuvable", 404);
}
