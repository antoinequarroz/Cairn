import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { authorized } from "@/server/session";
import { FILES_DIR, finishUpload, getUpload } from "@/server/db";
import { fail } from "@/server/http";

const CHUNK = 8 * 1024 * 1024;

/** One chunk of an upload started with POST /api/files. Chunks come in order, `offset` says where this one goes. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // This route is outside the middleware (see its matcher), so it checks the session itself.
  if (!(await authorized(req))) return fail("Non autorisé", 401);
  const { id } = await params;
  const upload = /^[\w-]+$/.test(id) ? getUpload(id) : undefined;
  if (!upload) return fail("Envoi introuvable", 404);

  const part = path.join(FILES_DIR, `${id}.part`);
  const received = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const offset = Number(new URL(req.url).searchParams.get("offset"));
  // A chunk sent twice (lost answer) or out of order: tell the client where the server stands.
  if (offset !== received) return NextResponse.json({ error: "Morceau inattendu", received }, { status: 409 });

  const chunk = Buffer.from(await req.arrayBuffer());
  if (!chunk.length || chunk.length > CHUNK || received + chunk.length > upload.size) return fail("Morceau invalide");
  fs.appendFileSync(part, chunk, { mode: 0o600 });

  if (received + chunk.length < upload.size) return NextResponse.json({ received: received + chunk.length });
  fs.renameSync(part, path.join(FILES_DIR, id));
  return NextResponse.json({ received: upload.size, file: finishUpload(id), url: `/api/files/${id}` });
}

