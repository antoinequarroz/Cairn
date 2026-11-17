import "server-only";
import type { SearchResult } from "@/lib/types";
import { db } from "./db";

/** Marks around the matched words in titles and snippets. Control characters: never in a note's text as typed. */
export const MARK_START = "\u0001";
export const MARK_END = "\u0002";

/**
 * Turns what was typed into an FTS5 query, so no input can be read as FTS syntax. Each word must be
 * found, as the beginning of a word ("cadd" finds "Caddy"). Words in quotes must follow each other.
 */
export function ftsQuery(input: string): string | null {
  const parts: string[] = [];
  for (const m of input.normalize("NFC").matchAll(/"([^"]*)"?|[^\s"]+/g)) {
    const words = (m[1] ?? m[0]).match(/[\p{L}\p{N}]+/gu);
    if (!words) continue;
    // A phrase: its words in this order. A lone word: anything starting with it.
    parts.push(m[1] !== undefined && words.length > 1 ? `"${words.join(" ")}"` : words.map((w) => `"${w}"*`).join(" "));
  }
  return parts.length ? parts.slice(0, 16).join(" ") : null;
}

/** A snippet without the Markdown symbols that would only be noise on one line. */
function clean(snippet: string) {
  return snippet
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+|\s#{1,6}\s+/g, " ")
    .replace(/\*\*|__|`+|^>\s?|\n>\s?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Row = {
  kind: "note" | "conversation" | "message";
  title: string;
  snippet: string;
  note_id: string | null;
  note_title: string | null;
  encrypted: number | null;
  conversation_id: string | null;
  conversation_title: string | null;
  folder_id: string | null;
  updated_at: string;
};

/**
 * Searches notes and AI discussions, best matches first. A discussion is found by its title or by
 * any of its messages, and comes back once. `folderId` limits the search to a folder and its subfolders.
 */
export function search(input: string, opts: { folderId?: string | null; limit?: number } = {}): SearchResult[] {
  const query = ftsQuery(input);
  if (!query) return [];
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const scoped = !!opts.folderId;
  const sql = `
    with recursive scope(id) as (select ? union select f.id from folders f join scope s on f.parent_id = s.id)
    select d.kind,
      highlight(search_fts, 0, char(1), char(2)) as title,
      snippet(search_fts, 1, char(1), char(2), '…', 16) as snippet,
      n.id as note_id, n.title as note_title, n.encrypted,
      coalesce(c.id, mc.id) as conversation_id, coalesce(c.title, mc.title) as conversation_title,
      coalesce(n.folder_id, c.folder_id, mc.folder_id) as folder_id,
      coalesce(n.updated_at, c.updated_at, mc.updated_at) as updated_at
    from search_fts
    join search_docs d on d.id = search_fts.rowid
    left join notes n on d.kind = 'note' and n.id = d.ref
    left join conversations c on d.kind = 'conversation' and c.id = d.ref
    left join messages m on d.kind = 'message' and m.id = d.ref
    left join conversations mc on mc.id = m.conversation_id
    where search_fts match ?
      and coalesce(n.id, c.id, mc.id) is not null
      ${scoped ? "and coalesce(n.folder_id, c.folder_id, mc.folder_id) in (select id from scope)" : ""}
    order by bm25(search_fts, 5.0, 1.0)
    limit ?`;

  let rows: Row[];
  try {
    rows = db()
      .prepare(sql)
      .all(opts.folderId ?? null, query, limit * 4) as Row[];
  } catch {
    // ftsQuery only builds valid queries; an index error must not break the search box.
    return [];
  }

  const out: SearchResult[] = [];
  const conversations = new Map<string, SearchResult>();
  for (const r of rows) {
    if (r.kind === "note" && r.note_id) {
      out.push({
        kind: "note",
        id: r.note_id,
        title: r.title || r.note_title || "",
        snippet: r.encrypted ? "" : clean(r.snippet),
        encrypted: !!r.encrypted,
        folderId: r.folder_id,
        updatedAt: r.updated_at,
      });
    } else if (r.conversation_id) {
      // The best hit of a discussion places it; a later hit only fills what is missing.
      const title = r.kind === "conversation" ? r.title : (r.conversation_title ?? "");
      const snippet = r.kind === "message" ? clean(r.snippet) : "";
      const seen = conversations.get(r.conversation_id);
      if (seen) {
        if (!seen.snippet && snippet) seen.snippet = snippet;
        if (r.kind === "conversation") seen.title = title;
        continue;
      }
      const result: SearchResult = { kind: "conversation", id: r.conversation_id, title, snippet, encrypted: false, folderId: r.folder_id, updatedAt: r.updated_at };
      conversations.set(r.conversation_id, result);
      out.push(result);
    }
    if (out.length >= limit) break;
  }
  return out;
}
