import "server-only";
import { unzipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { addFile, createFolder, createNote, db, FILES_DIR, newId, updateNote } from "./db";
import { MAX_NOTE, MAX_TITLE } from "./http";

/**
 * Import of notes from a zip: a Notion export ("Markdown & CSV"), or a folder of Markdown files
 * (zipped by the browser before sending).
 *
 * - each folder becomes a folder, each .md a note, each .csv (a Notion database) a note with a table;
 * - a Notion page with subpages ("Page.md" next to the folder "Page/") goes inside that folder;
 * - the ids Notion adds to names ("Page 1a2b…") are removed;
 * - images and files a note points to are imported, and the links rewritten to them;
 * - links between pages become links between notes.
 *
 * Everything lands in one new folder, inside `folderId` (or at the root).
 */

const MAX_ENTRIES = 20_000;
const MAX_FILE = Number(process.env.MAX_FILE_MB ?? 500) * 1024 * 1024;
// Against a zip bomb: what the archive says it holds once unpacked.
const MAX_TOTAL = 8 * 1024 * 1024 * 1024;
const MAX_DEPTH = 3;

const TEXT = /\.(md|markdown|txt)$/i;
const CSV = /\.csv$/i;
const IGNORED = /(^|\/)(__MACOSX|\.[^/]*)(\/|$)|(^|\/)(Thumbs\.db|desktop\.ini)$/i;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  heic: "image/heic",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  pdf: "application/pdf",
  zip: "application/zip",
};

export type ImportReport = {
  /** The folder that holds everything imported. */
  folderId: string;
  notes: number;
  folders: number;
  files: number;
  /** What could not be imported, and why (the first few). */
  skipped: string[];
};

export class ImportError extends Error {}

/** "Réunion 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d" → "Réunion": the id Notion adds to every name. */
export function cleanName(name: string) {
  return name.replace(/\s+[0-9a-f]{32}$/i, "").replace(/\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "").trim() || name.trim();
}

/** The title of a Markdown file: its first "# Heading" when it opens with one (then removed from the text), else its name. */
export function splitTitle(markdown: string, fallback: string): { title: string; content: string } {
  const text = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = text.match(/^\s*#\s+(.+?)\s*#*\s*(\n|$)/);
  if (!m) return { title: fallback, content: text };
  return { title: m[1].trim(), content: text.slice(m[0].length).replace(/^\n+/, "") };
}

/** Reads a CSV (RFC 4180: quotes, commas and line breaks inside quotes). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** A CSV as a Markdown table. */
export function csvToMarkdown(csv: string): string {
  const rows = parseCsv(csv);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (s = "") => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, "<br>").trim();
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(" | ")} |`;
  return [line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n") + "\n";
}

/**
 * Rewrites the relative links of a note: `resolve` gets the target, decoded and relative to the
 * archive's root, and returns the new address (or undefined to leave the link as it is).
 */
export function rewriteLinks(markdown: string, dir: string, resolve: (target: string) => string | undefined): string {
  const fix = (raw: string) => {
    const bare = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
    if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(bare)) return raw;
    const target = bare.split("#")[0];
    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {}
    const to = resolve(path.posix.normalize(path.posix.join(dir, decoded)));
    return to ?? raw;
  };
  return markdown
    .replace(/(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g, (_, a: string, url: string, b: string) => a + fix(url) + b)
    .replace(/(<(?:img|video|audio|source)\b[^>]*?\bsrc=")([^"]+)(")/gi, (_, a: string, url: string, b: string) => a + fix(url) + b);
}

type Entry = { path: string; size: number; read: () => Uint8Array };

/** The entries of a zip, those of the zips inside it included (Notion splits big exports in parts). */
function readZip(buf: Uint8Array, depth: number, out: Entry[], skipped: string[]) {
  const listed: { name: string; size: number }[] = [];
  try {
    unzipSync(buf, {
      filter: (f) => {
        listed.push({ name: f.name, size: f.originalSize });
        return false;
      },
    });
  } catch {
    throw new ImportError("Archive zip illisible");
  }
  for (const f of listed) {
    const name = f.name.replace(/\\/g, "/");
    if (name.endsWith("/") || IGNORED.test(name)) continue;
    const read = () => unzipSync(buf, { filter: (x) => x.name === f.name })[f.name];
    if (/\.zip$/i.test(name) && depth < MAX_DEPTH) {
      if (f.size > MAX_FILE) {
        skipped.push(`${name} : trop volumineux`);
        continue;
      }
      readZip(read(), depth + 1, out, skipped);
      continue;
    }
    out.push({ path: name, size: f.size, read });
    if (out.length > MAX_ENTRIES) throw new ImportError(`Trop de fichiers (${MAX_ENTRIES} au maximum)`);
  }
}

/** Safe path inside the archive: no "..", no absolute path. */
const safe = (p: string) => {
  const n = path.posix.normalize(p.replace(/^\/+/, ""));
  return n.startsWith("../") || n === ".." ? null : n;
};

const decoder = new TextDecoder("utf-8");

export function importZip(zip: Uint8Array, opts: { name: string; folderId: string | null }): ImportReport {
  const skipped: string[] = [];
  const entries: Entry[] = [];
  readZip(zip, 0, entries, skipped);
  if (entries.reduce((s, e) => s + e.size, 0) > MAX_TOTAL) throw new ImportError("Archive trop volumineuse une fois décompressée");

  const byPath = new Map<string, Entry>();
  for (const e of entries) {
    const p = safe(e.path);
    if (p) byPath.set(p, e);
  }

  // Notion wraps its export in a folder ("Export-<id>"): it says nothing, drop it.
  let paths = [...byPath.keys()];
  const tops = new Set(paths.map((p) => p.split("/")[0]));
  let rootName = opts.name.replace(/\.zip$/i, "").trim() || "Import";
  if (tops.size === 1 && paths.every((p) => p.includes("/"))) {
    const top = [...tops][0];
    if (/^Export-[0-9a-f-]+$/i.test(top)) rootName = "Import Notion";
    else rootName = cleanName(top);
    const strip = top.length + 1;
    const next = new Map<string, Entry>();
    for (const [p, e] of byPath) next.set(p.slice(strip), e);
    byPath.clear();
    for (const [p, e] of next) byPath.set(p, e);
    paths = [...byPath.keys()];
  }
  if (/^Export-[0-9a-f-]+(-Part-\d+)?$/i.test(rootName)) rootName = "Import Notion";

  // Notion gives a database both as "Base.csv" and as "Base_all.csv" (all its rows): keep the complete one.
  for (const p of paths) {
    const all = p.replace(/\.csv$/i, "_all.csv");
    if (CSV.test(p) && all !== p && byPath.has(all)) byPath.delete(p);
  }
  paths = [...byPath.keys()].sort((a, b) => a.localeCompare(b));

  const docs = paths.filter((p) => TEXT.test(p) || CSV.test(p));
  if (!docs.length) throw new ImportError("Aucune note trouvée (fichiers .md, .txt ou .csv)");
  // Folders holding notes, at any depth. One holding only a page's images does not become a folder.
  const dirs = new Set(docs.flatMap((p) => p.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))));

  const written: string[] = [];
  const report: ImportReport = { folderId: "", notes: 0, folders: 0, files: 0, skipped };
  try {
    db().transaction(() => {
      const root = createFolder({ name: rootName.slice(0, 200), parentId: opts.folderId });
      report.folderId = root.id;
      report.folders++;
      const folders = new Map<string, string>([["", root.id]]);
      const folderFor = (dir: string): string => {
        const known = folders.get(dir);
        if (known) return known;
        const parent = folderFor(path.posix.dirname(dir) === "." ? "" : path.posix.dirname(dir));
        const f = createFolder({ name: cleanName(path.posix.basename(dir)).slice(0, 200), parentId: parent });
        report.folders++;
        folders.set(dir, f.id);
        return f.id;
      };

      // First the notes, empty: links between them need every id.
      const notes = new Map<string, { id: string; dir: string; title: string; content: string }>();
      for (const p of docs) {
        const e = byPath.get(p)!;
        if (e.size > MAX_NOTE) {
          skipped.push(`${p} : trop long pour une note`);
          continue;
        }
        const base = p.replace(/\.[^./]+$/, "");
        const name = cleanName(path.posix.basename(base).replace(/_all$/, ""));
        const raw = decoder.decode(e.read());
        const { title, content } = CSV.test(p) ? { title: name, content: csvToMarkdown(raw) } : splitTitle(raw, name);
        // A page with subpages: it goes inside the folder of the same name.
        const own = base.replace(/_all$/, "");
        const dir = dirs.has(own) ? own : path.posix.dirname(p) === "." ? "" : path.posix.dirname(p);
        const note = createNote({ title: title.slice(0, MAX_TITLE), folderId: folderFor(dir) });
        notes.set(p, { id: note.id, dir: path.posix.dirname(p) === "." ? "" : path.posix.dirname(p), title, content });
        report.notes++;
      }

      const files = new Map<string, string>();
      const fileUrl = (p: string) => {
        const known = files.get(p);
        if (known) return known;
        const e = byPath.get(p);
        if (!e) return undefined;
        if (e.size > MAX_FILE) {
          skipped.push(`${p} : fichier trop volumineux`);
          return undefined;
        }
        const id = newId();
        const data = e.read();
        fs.writeFileSync(path.join(FILES_DIR, id), data, { mode: 0o600 });
        written.push(id);
        const ext = p.split(".").pop()!.toLowerCase();
        addFile({ id, name: path.posix.basename(p).slice(0, 200), mime: MIME[ext] ?? "application/octet-stream", size: data.length });
        report.files++;
        const url = `/api/files/${id}`;
        files.set(p, url);
        return url;
      };

      for (const n of notes.values()) {
        const content = rewriteLinks(n.content, n.dir, (target) => {
          const note = notes.get(target);
          if (note) return `/notes/${note.id}`;
          if (TEXT.test(target) || CSV.test(target)) return undefined;
          return fileUrl(target);
        });
        updateNote(n.id, { content: content.slice(0, MAX_NOTE) });
      }
    })();
  } catch (e) {
    for (const id of written) fs.rmSync(path.join(FILES_DIR, id), { force: true });
    throw e;
  }
  return report;
}
