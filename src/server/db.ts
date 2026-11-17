import "server-only";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { purgeSearchIndex, setupSearchIndex } from "./search-index";
import type { ChatMessage, ChatSource, Conversation, NotesSearch, ConversationSummary, FileInfo, Folder, Note, NoteSummary, VaultItemRow, VaultMeta } from "@/lib/types";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
export const FILES_DIR = path.join(DATA_DIR, "files");

const globalForDb = globalThis as unknown as { __cairnDb?: Database.Database };

export function db() {
  if (globalForDb.__cairnDb) return globalForDb.__cairnDb;
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const conn = new Database(path.join(DATA_DIR, "cairn.db"));
  conn.pragma("journal_mode = WAL");
  // Deleted content is overwritten in the file, not just marked free: a note locked with the
  // padlock must not leave its clear text behind (in the notes table or in the search index).
  conn.pragma("secure_delete = on");
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
    -- Folders, as a tree. A folder at the root is a project. Its instructions go to the AI in every
    -- discussion inside it, subfolders included.
    create table if not exists folders (
      id text primary key,
      parent_id text,
      name text not null,
      instructions text not null default '',
      created_at text not null,
      updated_at text not null
    );
    create index if not exists folders_parent on folders (parent_id);
    -- AI discussions. context_note_ids: JSON array of the notes the AI reads with each message.
    create table if not exists conversations (
      id text primary key,
      folder_id text,
      title text not null default '',
      context_note_ids text not null default '[]',
      -- Delimits the pinned notes in the prompt. Random, and the same for the whole discussion, so
      -- the prompt keeps the same beginning from one message to the next (Anthropic's cache needs it).
      prompt_nonce text not null default '',
      created_at text not null,
      updated_at text not null
    );
    create index if not exists conversations_updated on conversations (updated_at desc);
    -- One row per message. An answer is written while it streams (state = 'streaming').
    create table if not exists messages (
      id text primary key,
      conversation_id text not null,
      role text not null check (role in ('user', 'assistant')),
      content text not null default '',
      state text not null default 'done' check (state in ('streaming', 'done', 'stopped', 'error')),
      error text,
      model text,
      seq integer not null,
      created_at text not null
    );
    create index if not exists messages_conversation on messages (conversation_id, seq);
  `);
  // Databases created before folders existed: notes get their folder column.
  const noteColumns = conn.prepare("pragma table_info(notes)").all() as { name: string }[];
  if (!noteColumns.some((c) => c.name === "folder_id")) conn.exec("alter table notes add column folder_id text");
  conn.exec("create index if not exists notes_folder on notes (folder_id)");
  const conversationColumns = conn.prepare("pragma table_info(conversations)").all() as { name: string }[];
  if (!conversationColumns.some((c) => c.name === "prompt_nonce")) conn.exec("alter table conversations add column prompt_nonce text not null default ''");
  // "Mes notes" mode: the AI searches the notes (all of them, or one folder's) with each message.
  if (!conversationColumns.some((c) => c.name === "notes_search")) conn.exec("alter table conversations add column notes_search integer not null default 0; alter table conversations add column notes_search_folder_id text");
  // The notes found for an answer in "Mes notes" mode, as JSON [{ id, title }].
  const messageColumns = conn.prepare("pragma table_info(messages)").all() as { name: string }[];
  if (!messageColumns.some((c) => c.name === "sources")) conn.exec("alter table messages add column sources text");
  // An answer still marked as streaming when the server starts was cut by a restart: nothing writes it anymore.
  conn.prepare("update messages set state = 'stopped' where state = 'streaming'").run();
  setupSearchIndex(conn);
  globalForDb.__cairnDb = conn;
  return conn;
}

export const newId = () => crypto.randomBytes(9).toString("base64url");
const now = () => new Date().toISOString();

type NoteRow = { id: string; title: string; content: string; encrypted: number; folder_id: string | null; created_at: string; updated_at: string };

const toNote = (r: NoteRow): Note => ({ id: r.id, title: r.title, content: r.content, encrypted: !!r.encrypted, folderId: r.folder_id, createdAt: r.created_at, updatedAt: r.updated_at });

export function listNotes(): NoteSummary[] {
  const rows = db().prepare("select id, title, encrypted, folder_id, updated_at, case when encrypted = 1 then '' else substr(content, 1, 400) end as content, created_at from notes order by updated_at desc").all() as NoteRow[];
  return rows.map((r) => ({ id: r.id, title: r.title, encrypted: !!r.encrypted, folderId: r.folder_id, updatedAt: r.updated_at, excerpt: r.content.replace(/\s+/g, " ").trim().slice(0, 160) }));
}

export function getNote(id: string): Note | null {
  const r = db().prepare("select * from notes where id = ?").get(id) as NoteRow | undefined;
  return r ? toNote(r) : null;
}

export function createNote(input: { title?: string; content?: string; folderId?: string | null }): Note {
  const t = now();
  const id = newId();
  db().prepare("insert into notes (id, title, content, encrypted, folder_id, created_at, updated_at) values (?, ?, ?, 0, ?, ?, ?)").run(id, input.title ?? "", input.content ?? "", input.folderId ?? null, t, t);
  return getNote(id)!;
}

/** `folderId`: undefined keeps the folder, null moves the note to the root. Moving a note does not change its date. */
export function updateNote(id: string, patch: { title?: string; content?: string; encrypted?: boolean; folderId?: string | null }): Note | null {
  const cur = getNote(id);
  if (!cur) return null;
  const touched =
    (patch.title !== undefined && patch.title !== cur.title) || (patch.content !== undefined && patch.content !== cur.content) || (patch.encrypted !== undefined && patch.encrypted !== cur.encrypted);
  db()
    .prepare("update notes set title = ?, content = ?, encrypted = ?, folder_id = ?, updated_at = ? where id = ?")
    .run(patch.title ?? cur.title, patch.content ?? cur.content, (patch.encrypted ?? cur.encrypted) ? 1 : 0, patch.folderId === undefined ? cur.folderId : patch.folderId, touched ? now() : cur.updatedAt, id);
  if (patch.encrypted && !cur.encrypted) purgeSearchIndex(db());
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

/** Adds many items at once, all or nothing: an import never stops halfway. */
export function addVaultItems(blobs: string[]): number {
  const insert = db().prepare("insert into vault_items (id, data, updated_at) values (?, ?, ?)");
  const at = now();
  db().transaction(() => blobs.forEach((data) => insert.run(newId(), data, at)))();
  return blobs.length;
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

/** Forgets a file. The caller removes it from FILES_DIR. */
export const deleteFile = (id: string) => db().prepare("delete from files where id = ?").run(id).changes > 0;

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

// --- Folders -------------------------------------------------------------------------------------

type FolderRow = { id: string; parent_id: string | null; name: string; instructions: string; created_at: string; updated_at: string };

const toFolder = (r: FolderRow): Folder => ({ id: r.id, parentId: r.parent_id, name: r.name, instructions: r.instructions, createdAt: r.created_at, updatedAt: r.updated_at });

export function listFolders(): Folder[] {
  return (db().prepare("select * from folders order by name collate nocase, created_at").all() as FolderRow[]).map(toFolder);
}

export function getFolder(id: string): Folder | null {
  const r = db().prepare("select * from folders where id = ?").get(id) as FolderRow | undefined;
  return r ? toFolder(r) : null;
}

/** The folder and its parents, from the folder up to its project (the root folder). */
export function folderChain(id: string | null): Folder[] {
  const chain: Folder[] = [];
  const seen = new Set<string>();
  for (let cur = id ? getFolder(id) : null; cur && !seen.has(cur.id); cur = cur.parentId ? getFolder(cur.parentId) : null) {
    seen.add(cur.id);
    chain.push(cur);
  }
  return chain;
}

/** True when `folderId` is `ancestorId` or lies somewhere inside it: moving `ancestorId` there would make a loop. */
export function isInside(folderId: string, ancestorId: string) {
  return folderChain(folderId).some((f) => f.id === ancestorId);
}

export function createFolder(input: { name: string; parentId?: string | null; instructions?: string }): Folder {
  const t = now();
  const id = newId();
  db().prepare("insert into folders (id, parent_id, name, instructions, created_at, updated_at) values (?, ?, ?, ?, ?, ?)").run(id, input.parentId ?? null, input.name, input.instructions ?? "", t, t);
  return getFolder(id)!;
}

/** `parentId`: undefined keeps the parent, null moves the folder to the root. The caller checks for loops (isInside). */
export function updateFolder(id: string, patch: { name?: string; parentId?: string | null; instructions?: string }): Folder | null {
  const cur = getFolder(id);
  if (!cur) return null;
  db()
    .prepare("update folders set name = ?, parent_id = ?, instructions = ?, updated_at = ? where id = ?")
    .run(patch.name ?? cur.name, patch.parentId === undefined ? cur.parentId : patch.parentId, patch.instructions ?? cur.instructions, now(), id);
  return getFolder(id);
}

/**
 * Deletes a folder, never what it holds: its notes, discussions and subfolders move up to its
 * parent (or to the root). Deleting a folder by mistake loses a name, not a note.
 */
export function deleteFolder(id: string) {
  const cur = getFolder(id);
  if (!cur) return false;
  db().transaction(() => {
    db().prepare("update notes set folder_id = ? where folder_id = ?").run(cur.parentId, id);
    db().prepare("update conversations set folder_id = ? where folder_id = ?").run(cur.parentId, id);
    // A discussion that searched this folder now searches its parent (all the notes, at the root).
    db().prepare("update conversations set notes_search_folder_id = ? where notes_search_folder_id = ?").run(cur.parentId, id);
    db().prepare("update folders set parent_id = ? where parent_id = ?").run(cur.parentId, id);
    db().prepare("delete from folders where id = ?").run(id);
  })();
  return true;
}

// --- Discussions with the AI ---------------------------------------------------------------------

type ConversationRow = {
  id: string;
  folder_id: string | null;
  title: string;
  context_note_ids: string;
  prompt_nonce: string;
  notes_search: number;
  notes_search_folder_id: string | null;
  created_at: string;
  updated_at: string;
};

const parseIds = (json: string): string[] => {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  folderId: r.folder_id,
  title: r.title,
  contextNoteIds: parseIds(r.context_note_ids),
  notesSearch: r.notes_search ? { folderId: r.notes_search_folder_id } : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listConversations(): ConversationSummary[] {
  const rows = db().prepare("select id, folder_id, title, updated_at from conversations order by updated_at desc").all() as ConversationRow[];
  return rows.map((r) => ({ id: r.id, folderId: r.folder_id, title: r.title, updatedAt: r.updated_at }));
}

export function getConversation(id: string): Conversation | null {
  const r = db().prepare("select * from conversations where id = ?").get(id) as ConversationRow | undefined;
  return r ? toConversation(r) : null;
}

export function createConversation(input: { folderId?: string | null; title?: string; contextNoteIds?: string[]; notesSearch?: NotesSearch | null }): Conversation {
  const t = now();
  const id = newId();
  db()
    .prepare("insert into conversations (id, folder_id, title, context_note_ids, prompt_nonce, notes_search, notes_search_folder_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, input.folderId ?? null, input.title ?? "", JSON.stringify(input.contextNoteIds ?? []), crypto.randomBytes(8).toString("hex"), input.notesSearch ? 1 : 0, input.notesSearch?.folderId ?? null, t, t);
  return getConversation(id)!;
}

/**
 * `folderId`: undefined keeps the folder, null moves the discussion to the root. Moving it does not
 * change its date: it was not written in.
 */
export function updateConversation(id: string, patch: { title?: string; folderId?: string | null; contextNoteIds?: string[]; notesSearch?: NotesSearch | null }): Conversation | null {
  const cur = getConversation(id);
  if (!cur) return null;
  const ids = patch.contextNoteIds ?? cur.contextNoteIds;
  const search = patch.notesSearch === undefined ? cur.notesSearch : patch.notesSearch;
  const touched = (patch.title !== undefined && patch.title !== cur.title) || JSON.stringify(ids) !== JSON.stringify(cur.contextNoteIds);
  db()
    .prepare("update conversations set title = ?, folder_id = ?, context_note_ids = ?, notes_search = ?, notes_search_folder_id = ?, updated_at = ? where id = ?")
    .run(patch.title ?? cur.title, patch.folderId === undefined ? cur.folderId : patch.folderId, JSON.stringify(ids), search ? 1 : 0, search?.folderId ?? null, touched ? now() : cur.updatedAt, id);
  return getConversation(id);
}

/** The discussion's prompt identifier. Only the server reads it: it never goes to the browser. */
export function conversationNonce(id: string): string {
  const r = db().prepare("select prompt_nonce from conversations where id = ?").get(id) as { prompt_nonce: string } | undefined;
  return r?.prompt_nonce ?? "";
}

export function setConversationNonce(id: string, nonce: string) {
  db().prepare("update conversations set prompt_nonce = ? where id = ?").run(nonce, id);
}

export function deleteConversation(id: string) {
  return db().transaction(() => {
    db().prepare("delete from messages where conversation_id = ?").run(id);
    return db().prepare("delete from conversations where id = ?").run(id).changes > 0;
  })();
}

type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  state: ChatMessage["state"];
  error: string | null;
  model: string | null;
  sources: string | null;
  created_at: string;
};

const parseSources = (json: string | null): ChatSource[] | null => {
  if (!json) return null;
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is ChatSource => !!x && typeof x.id === "string" && typeof x.title === "string") : null;
  } catch {
    return null;
  }
};

const toMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  role: r.role,
  content: r.content,
  state: r.state,
  ...(r.error ? { error: r.error } : {}),
  ...(r.model ? { model: r.model } : {}),
  ...(r.sources ? { sources: parseSources(r.sources) ?? [] } : {}),
  createdAt: r.created_at,
});

export function listMessages(conversationId: string): ChatMessage[] {
  return (db().prepare("select * from messages where conversation_id = ? order by seq").all(conversationId) as MessageRow[]).map(toMessage);
}

export function getMessage(id: string): ChatMessage | null {
  const r = db().prepare("select * from messages where id = ?").get(id) as MessageRow | undefined;
  return r ? toMessage(r) : null;
}

/** Adds a message at the end of a discussion, and moves the discussion to the top of the recent ones. */
export function addMessage(conversationId: string, m: { role: ChatMessage["role"]; content: string; state?: ChatMessage["state"]; model?: string }): ChatMessage {
  const t = now();
  const id = newId();
  db().transaction(() => {
    const { next } = db().prepare("select coalesce(max(seq), 0) + 1 as next from messages where conversation_id = ?").get(conversationId) as { next: number };
    db()
      .prepare("insert into messages (id, conversation_id, role, content, state, model, seq, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, conversationId, m.role, m.content, m.state ?? "done", m.model ?? null, next, t);
    db().prepare("update conversations set updated_at = ? where id = ?").run(t, conversationId);
  })();
  return getMessage(id)!;
}

/** Records the notes found for an answer in "Mes notes" mode. */
export function setMessageSources(id: string, sources: ChatSource[]) {
  db().prepare("update messages set sources = ? where id = ?").run(JSON.stringify(sources), id);
}

export function updateMessage(id: string, patch: { content?: string; state?: ChatMessage["state"]; error?: string | null }) {
  const cur = db().prepare("select content, state, error from messages where id = ?").get(id) as Pick<MessageRow, "content" | "state" | "error"> | undefined;
  if (!cur) return;
  db()
    .prepare("update messages set content = ?, state = ?, error = ? where id = ?")
    .run(patch.content ?? cur.content, patch.state ?? cur.state, patch.error === undefined ? cur.error : patch.error, id);
}
