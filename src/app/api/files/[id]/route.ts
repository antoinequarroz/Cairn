import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { FILES_DIR, getFile } from "@/server/db";
import { fail } from "@/server/http";

// Only these are shown in the page. Everything else (HTML, SVG...) is downloaded, so an uploaded
// file can never run script on the app's own origin.
const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav|webm)|application\/pdf)$/;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const info = /^[\w-]+$/.test(id) ? getFile(id) : null;
  const file = path.join(FILES_DIR, id);
  if (!info || !fs.existsSync(file)) return fail("Fichier introuvable", 404);

  const size = fs.statSync(file).size;
  const inline = INLINE.test(info.mime);
  const headers = new Headers({
    "Content-Type": inline ? info.mime : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(info.name)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  });

  // Range requests: Safari refuses to play a video without them.
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers });
}
