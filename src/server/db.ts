import "server-only";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FileInfo, Note, NoteSummary, VaultItemRow, VaultMeta } from "@/lib/types";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
export const FILES_DIR = path.join(DATA_DIR, "files");

const globalForDb = globalThis as unknown as { __cairnDb?: Database.Database };

export function db() {
  if (globalForDb.__cairnDb) return globalForDb.__cairnDb;
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const conn = new Database(path.join(DATA_DIR, "cairn.db"));
  conn.pragma("journal_mode = WAL");
  conn.exec(`
    create table if not exists notes (
      id text primary key,
      title text not null default '',
      -- Markdown, or an encrypted blob when encrypted = 1 (the server can't read it)
      content text not null default '',
      encrypted integer not null default 0,
      created_at text not null,
      updated_at text not null
    );
    create index if not exists notes_updated on notes (updated_at desc);
    -- One row: how to derive the key from the master password, and the vault key wrapped by it.
    create table if not exists vault_meta (
      id integer primary key check (id = 1),
      data text not null
    );
    -- Each item is one encrypted blob: type, name and secrets are all unreadable here.
    create table if not exists vault_items (
      id text primary key,
      data text not null,
      updated_at text not null
    );
    create table if not exists files (
      id text primary key,
      name text not null,
      mime text not null,
      size integer not null,
      created_at text not null
    );
    -- Small app settings, one JSON value per key. Secrets inside are sealed (src/server/secret-box.ts).
    create table if not exists settings (
      key text primary key,
      value text not null
    );
    -- Files still being sent, chunk by chunk.
    create table if not exists uploads (
      id text primary key,
      name text not null,
      mime text not null,
      size integer not null,
      created_at text not null
    );
  `);
  globalForDb.__cairnDb = conn;
  return conn;
}

export const newId = () => crypto.randomBytes(9).toString("base64url");
const now = () => new Date().toISOString();

type NoteRow = { id: string; title: string; content: string; encrypted: number; created_at: string; updated_at: string };

const toNote = (r: NoteRow): Note => ({ id: r.id, title: r.title, content: r.content, encrypted: !!r.encrypted, createdAt: r.created_at, updatedAt: r.updated_at });

export function listNotes(): NoteSummary[] {
  const rows = db().prepare("select id, title, encrypted, updated_at, case when encrypted = 1 then '' else substr(content, 1, 400) end as content, created_at from notes order by updated_at desc").all() as NoteRow[];
  return rows.map((r) => ({ id: r.id, title: r.title, encrypted: !!r.encrypted, updatedAt: r.updated_at, excerpt: r.content.replace(/\s+/g, " ").trim().slice(0, 160) }));
}

export function getNote(id: string): Note | null {
  const r = db().prepare("select * from notes where id = ?").get(id) as NoteRow | undefined;
  return r ? toNote(r) : null;
}

export function createNote(input: { title?: string; content?: string }): Note {
  const t = now();
  const id = newId();
  db().prepare("insert into notes (id, title, content, encrypted, created_at, updated_at) values (?, ?, ?, 0, ?, ?)").run(id, input.title ?? "", input.content ?? "", t, t);
  return getNote(id)!;
}

export function updateNote(id: string, patch: { title?: string; content?: string; encrypted?: boolean }): Note | null {
  const cur = getNote(id);
  if (!cur) return null;
  db()
    .prepare("update notes set title = ?, content = ?, encrypted = ?, updated_at = ? where id = ?")
    .run(patch.title ?? cur.title, patch.content ?? cur.content, (patch.encrypted ?? cur.encrypted) ? 1 : 0, now(), id);
  return getNote(id);
}

export const deleteNote = (id: string) => db().prepare("delete from notes where id = ?").run(id).changes > 0;

export function getVaultMeta(): VaultMeta | null {
  const r = db().prepare("select data from vault_meta where id = 1").get() as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as VaultMeta) : null;
}

/** Creates the vault once. Returns false if it already exists: it must never be silently replaced. */
export function createVaultMeta(meta: VaultMeta) {
  return db().prepare("insert or ignore into vault_meta (id, data) values (1, ?)").run(JSON.stringify(meta)).changes > 0;
}

export function listVaultItems(): VaultItemRow[] {
  const rows = db().prepare("select id, data, updated_at from vault_items order by updated_at desc").all() as { id: string; data: string; updated_at: string }[];
  return rows.map((r) => ({ id: r.id, data: r.data, updatedAt: r.updated_at }));
}

export function saveVaultItem(id: string | undefined, data: string): VaultItemRow {
  const item = { id: id ?? newId(), data, updatedAt: now() };
  db().prepare("insert into vault_items (id, data, updated_at) values (?, ?, ?) on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at").run(item.id, item.data, item.updatedAt);
  return item;
}

export const deleteVaultItem = (id: string) => db().prepare("delete from vault_items where id = ?").run(id).changes > 0;

export function addFile(f: Omit<FileInfo, "createdAt">): FileInfo {
  const file = { ...f, createdAt: now() };
  db().prepare("insert into files (id, name, mime, size, created_at) values (?, ?, ?, ?, ?)").run(file.id, file.name, file.mime, file.size, file.createdAt);
  return file;
}

export function getFile(id: string): FileInfo | null {
  const r = db().prepare("select id, name, mime, size, created_at from files where id = ?").get(id) as { id: string; name: string; mime: string; size: number; created_at: string } | undefined;
  return r ? { id: r.id, name: r.name, mime: r.mime, size: r.size, createdAt: r.created_at } : null;
}

export function startUpload(f: { name: string; mime: string; size: number }) {
  const id = newId();
  db().prepare("insert into uploads (id, name, mime, size, created_at) values (?, ?, ?, ?, ?)").run(id, f.name, f.mime, f.size, now());
  return id;
}

export function getUpload(id: string) {
  return db().prepare("select id, name, mime, size from uploads where id = ?").get(id) as { id: string; name: string; mime: string; size: number } | undefined;
}

/** The upload is complete: it becomes a file. */
export function finishUpload(id: string): FileInfo {
  const u = getUpload(id)!;
  return db().transaction(() => {
    db().prepare("delete from uploads where id = ?").run(id);
    return addFile(u);
  })();
}

/** Uploads abandoned for more than a day, to clean up. */
export function staleUploads(): string[] {
  const limit = new Date(Date.now() - 86_400_000).toISOString();
  const ids = (db().prepare("select id from uploads where created_at < ?").all(limit) as { id: string }[]).map((r) => r.id);
  if (ids.length) db().prepare("delete from uploads where created_at < ?").run(limit);
  return ids;
}

export function getSetting<T>(key: string): T | null {
  const r = db().prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
  if (!r) return null;
  try {
    return JSON.parse(r.value) as T;
  } catch {
    return null;
  }
}

export function setSetting(key: string, value: unknown) {
  db().prepare("insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value").run(key, JSON.stringify(value));
}
