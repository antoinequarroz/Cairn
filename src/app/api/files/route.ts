import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { FILES_DIR, staleUploads, startUpload } from "@/server/db";
import { body, fail } from "@/server/http";

const MAX_FILE = Number(process.env.MAX_FILE_MB ?? 500) * 1024 * 1024;
const CHUNK = 8 * 1024 * 1024;

/**
 * Starts the upload of an image, a video or any file dropped into a note.
 * The content then comes in chunks (PUT /api/uploads/:id?offset=N): the server cuts bigger bodies,
 * and a long video survives a short network loss.
 */
export async function POST(req: Request) {
  const b = await body(req);
  const size = b.size;
  if (typeof b.name !== "string" || typeof size !== "number" || !Number.isInteger(size) || size <= 0) return fail("Fichier invalide");
  if (size > MAX_FILE) return fail(`Fichier trop volumineux (${Math.round(MAX_FILE / 1024 / 1024)} Mo au maximum)`, 413);

  for (const old of staleUploads()) fs.rmSync(path.join(FILES_DIR, `${old}.part`), { force: true });

  const mime = typeof b.mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(b.mime) ? b.mime : "application/octet-stream";
  const id = startUpload({ name: path.basename(b.name).slice(0, 200) || "fichier", mime, size });
  return NextResponse.json({ id, chunk: CHUNK }, { status: 201 });
}
