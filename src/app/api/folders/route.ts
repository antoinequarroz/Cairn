import { NextResponse } from "next/server";
import { MAX_FOLDER_INSTRUCTIONS, MAX_FOLDER_NAME } from "@/lib/chat";
import { createFolder, listFolders } from "@/server/db";
import { body, fail, folderRef, text } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ folders: listFolders() });
}

export async function POST(req: Request) {
  const b = await body(req);
  const name = text(b.name, MAX_FOLDER_NAME)?.trim();
  const instructions = text(b.instructions, MAX_FOLDER_INSTRUCTIONS);
  const parentId = folderRef(b.parentId);
  if (!name || instructions === null || parentId === false) return fail("Dossier invalide");
  return NextResponse.json({ folder: createFolder({ name, parentId, instructions }) }, { status: 201 });
}
