import type Database from "better-sqlite3";

// Bump when the index's shape or tokenizer changes: the index is then rebuilt from the tables.
const VERSION = 1;

/**
 * Full-text index (SQLite FTS5) over notes, AI discussions and their messages.
 *
 * search_docs maps each FTS row to what it indexes. Triggers on the tables keep the index in step
 * with every write, whatever route made it. An encrypted note is indexed by its title only: its
 * content is a blob the server can't read, and must never end up readable in the index.
 * An answer is indexed once it stops streaming, not at every token.
 */
export function setupSearchIndex(conn: Database.Database) {
  conn.exec(`
    create table if not exists search_docs (
      id integer primary key,
      kind text not null check (kind in ('note', 'conversation', 'message')),
      ref text not null,
      unique (kind, ref)
    );
    -- remove_diacritics: "eleve" finds "élève".
    create virtual table if not exists search_fts using fts5(title, body, tokenize = 'unicode61 remove_diacritics 2');

    create trigger if not exists search_note_insert after insert on notes begin
      insert into search_docs (kind, ref) values ('note', new.id);
      insert into search_fts (rowid, title, body) values (last_insert_rowid(), new.title, case when new.encrypted = 1 then '' else new.content end);
    end;
    create trigger if not exists search_note_update after update of title, content, encrypted on notes begin
      update search_fts set title = new.title, body = case when new.encrypted = 1 then '' else new.content end
        where rowid = (select id from search_docs where kind = 'note' and ref = new.id);
    end;
    create trigger if not exists search_note_delete after delete on notes begin
      delete from search_fts where rowid = (select id from search_docs where kind = 'note' and ref = old.id);
      delete from search_docs where kind = 'note' and ref = old.id;
    end;

    create trigger if not exists search_conversation_insert after insert on conversations begin
      insert into search_docs (kind, ref) values ('conversation', new.id);
      insert into search_fts (rowid, title, body) values (last_insert_rowid(), new.title, '');
    end;
    create trigger if not exists search_conversation_update after update of title on conversations begin
      update search_fts set title = new.title where rowid = (select id from search_docs where kind = 'conversation' and ref = new.id);
    end;
    create trigger if not exists search_conversation_delete after delete on conversations begin
      delete from search_fts where rowid = (select id from search_docs where kind = 'conversation' and ref = old.id);
      delete from search_docs where kind = 'conversation' and ref = old.id;
    end;

    create trigger if not exists search_message_insert after insert on messages when new.state != 'streaming' begin
      insert into search_docs (kind, ref) values ('message', new.id);
      insert into search_fts (rowid, title, body) values (last_insert_rowid(), '', new.content);
    end;
    create trigger if not exists search_message_update after update of content, state on messages when new.state != 'streaming' begin
      insert or ignore into search_docs (kind, ref) values ('message', new.id);
      delete from search_fts where rowid = (select id from search_docs where kind = 'message' and ref = new.id);
      insert into search_fts (rowid, title, body) values ((select id from search_docs where kind = 'message' and ref = new.id), '', new.content);
    end;
    create trigger if not exists search_message_delete after delete on messages begin
      delete from search_fts where rowid = (select id from search_docs where kind = 'message' and ref = old.id);
      delete from search_docs where kind = 'message' and ref = old.id;
    end;
  `);

  const row = conn.prepare("select value from settings where key = 'search_index_version'").get() as { value: string } | undefined;
  if (row?.value !== String(VERSION)) rebuildSearchIndex(conn);
}

/** Fills the index from the tables, from scratch. */
export function rebuildSearchIndex(conn: Database.Database) {
  conn.transaction(() => {
    conn.exec(`
      delete from search_fts;
      delete from search_docs;
      insert into search_docs (kind, ref) select 'note', id from notes;
      insert into search_docs (kind, ref) select 'conversation', id from conversations;
      insert into search_docs (kind, ref) select 'message', id from messages where state != 'streaming';
      insert into search_fts (rowid, title, body)
        select d.id, n.title, case when n.encrypted = 1 then '' else n.content end from notes n join search_docs d on d.kind = 'note' and d.ref = n.id;
      insert into search_fts (rowid, title, body)
        select d.id, c.title, '' from conversations c join search_docs d on d.kind = 'conversation' and d.ref = c.id;
      insert into search_fts (rowid, title, body)
        select d.id, '', m.content from messages m join search_docs d on d.kind = 'message' and d.ref = m.id;
      insert into search_fts (search_fts) values ('optimize');
    `);
    conn.prepare("insert into settings (key, value) values ('search_index_version', ?) on conflict (key) do update set value = excluded.value").run(String(VERSION));
  })();
}

/**
 * FTS5 keeps deleted words in its segments until they are merged. After a note is locked, merge
 * them now: the words of its old clear content must not stay in the database file.
 */
export function purgeSearchIndex(conn: Database.Database) {
  conn.prepare("insert into search_fts (search_fts) values ('optimize')").run();
}
