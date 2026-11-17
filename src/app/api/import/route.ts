import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { deleteFile, FILES_DIR, getFile } from "@/server/db";
import { body, fail, folderRef } from "@/server/http";
import { ImportError, importZip } from "@/server/import";

export const dynamic = "force-dynamic";

/**
 * Imports a zip sent beforehand with POST /api/files: a Notion export, or a folder of Markdown files.
 * `folderId`: where to put the folder created for the import (the root when absent).
 * The zip itself is not kept.
 */
export async function POST(req: Request) {
  const b = await body(req);
  const folderId = folderRef(b.folderId);
  const fileId = typeof b.fileId === "string" && /^[\w-]+$/.test(b.fileId) ? b.fileId : null;
  const info = fileId ? getFile(fileId) : null;
  const file = fileId ? path.join(FILES_DIR, fileId) : "";
  if (!info || folderId === false || !fs.existsSync(file)) return fail("Import invalide");

  try {
    const report = importZip(fs.readFileSync(file), { name: info.name, folderId: folderId ?? null });
    return NextResponse.json({ report }, { status: 201 });
  } catch (e) {
    if (e instanceof ImportError) return fail(e.message);
    throw e;
  } finally {
    fs.rmSync(file, { force: true });
    deleteFile(info.id);
  }
}
