import "server-only";
import { excerpt, type FoundNote, MAX_FOUND_CHARS, MAX_FOUND_NOTES, searchTerms } from "@/lib/chat";
import { db, folderChain } from "./db";

type Row = { id: string; title: string; content: string; encrypted: number; folder_id: string | null };

/**
 * The notes that best match a message, for the "Mes notes" mode of a discussion: a keyword search
 * in the full-text index (src/server/search-index.ts), any of the words, best matches first.
 *
 * End-to-end encrypted notes are never returned: the query leaves them out, and a second check
 * below drops any that would get through. Their content is a blob the server cannot read anyway.
 *
 * `folderId` limits the search to a folder and its subfolders; `exclude` leaves out notes already
 * in the discussion (pinned ones). `previous` is the user's message before this one: a follow-up
 * ("et pour le port ?") borrows its words when its own find too little.
 */
export function findNotes(message: string, opts: { folderId?: string | null; exclude?: string[]; previous?: string } = {}): { notes: FoundNote[]; terms: string[] } {
  let terms = searchTerms(message);
  let rows = query(terms, opts);
  if (rows.length < 3 && opts.previous) {
    const more = searchTerms(`${message} ${opts.previous}`, 16);
    if (more.length > terms.length) {
      terms = more;
      rows = query(terms, opts);
    }
  }

  const notes: FoundNote[] = [];
  let budget = MAX_FOUND_CHARS;
  for (const r of rows) {
    if (r.encrypted) continue;
    if (budget < 500 || notes.length >= MAX_FOUND_NOTES) break;
    const content = excerpt(r.content, terms, Math.min(budget, 8_000));
    budget -= content.length + r.title.length;
    const path = folderChain(r.folder_id)
      .reverse()
      .map((f) => f.name)
      .join(" / ");
    notes.push({ id: r.id, title: r.title, content, path });
  }
  return { notes, terms };
}

function query(terms: string[], opts: { folderId?: string | null; exclude?: string[] }): Row[] {
  if (!terms.length) return [];
  // Each word quoted, so nothing typed is read as FTS syntax; a word of 4 letters or more also finds
  // longer ones ("certif" finds "certificat"), a shorter one only itself (else "ip" finds everything).
  const match = terms.map((t) => (t.length >= 4 ? `"${t}"*` : `"${t}"`)).join(" OR ");
  const exclude = opts.exclude ?? [];
  const scoped = !!opts.folderId;
  const sql = `
    with recursive scope(id) as (select ? union select f.id from folders f join scope s on f.parent_id = s.id)
    select n.id, n.title, n.content, n.encrypted, n.folder_id
    from search_fts
    join search_docs d on d.id = search_fts.rowid and d.kind = 'note'
    join notes n on n.id = d.ref
    where search_fts match ?
      and n.encrypted = 0
      and trim(n.content) != ''
      ${scoped ? "and n.folder_id in (select id from scope)" : ""}
      ${exclude.length ? `and n.id not in (${exclude.map(() => "?").join(", ")})` : ""}
    order by bm25(search_fts, 5.0, 1.0)
    limit ?`;
  try {
    return db()
      .prepare(sql)
      .all(opts.folderId ?? null, match, ...exclude, MAX_FOUND_NOTES * 2) as Row[];
  } catch {
    return [];
  }
}
