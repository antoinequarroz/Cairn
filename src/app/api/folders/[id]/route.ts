import { NextResponse } from "next/server";
import { MAX_FOLDER_INSTRUCTIONS, MAX_FOLDER_NAME } from "@/lib/chat";
import { deleteFolder, getFolder, isInside, updateFolder } from "@/server/db";
import { body, fail, folderRef, text } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const folder = getFolder((await params).id);
  return folder ? NextResponse.json({ folder }) : fail("Dossier introuvable", 404);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const b = await body(req);
  const rawName = text(b.name, MAX_FOLDER_NAME);
  const name = rawName?.trim();
  const instructions = text(b.instructions, MAX_FOLDER_INSTRUCTIONS);
  const parentId = folderRef(b.parentId);
  if (rawName === null || name === "" || instructions === null || parentId === false) return fail("Dossier invalide");
  if (!getFolder(id)) return fail("Dossier introuvable", 404);
  // A folder cannot go inside itself or one of its own subfolders.
  if (parentId && isInside(parentId, id)) return fail("Un dossier ne peut pas aller dans lui-même ou dans un de ses sous-dossiers");
  const folder = updateFolder(id, { name, instructions, parentId });
  return folder ? NextResponse.json({ folder }) : fail("Dossier introuvable", 404);
}

/** Its content moves up to its parent: deleting a folder never deletes a note or a discussion. */
export async function DELETE(_: Request, { params }: Ctx) {
  return deleteFolder((await params).id) ? NextResponse.json({ ok: true }) : fail("Dossier introuvable", 404);
}
