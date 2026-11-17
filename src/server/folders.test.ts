import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "cairn-folders-"));
  process.env.DATA_DIR = dir;
  // A database from before folders: notes without folder_id, and one note in it.
  const Database = (await import("better-sqlite3")).default;
  const old = new Database(join(dir, "cairn.db"));
  old.exec("create table notes (id text primary key, title text not null default '', content text not null default '', encrypted integer not null default 0, created_at text not null, updated_at text not null)");
  old.prepare("insert into notes values ('ancienne', 'Ancienne note', 'texte', 0, '2026-01-01', '2026-01-01')").run();
  old.close();
});

import {
  addMessage,
  createConversation,
  createFolder,
  createNote,
  deleteConversation,
  deleteFolder,
  folderChain,
  getConversation,
  getNote,
  isInside,
  listFolders,
  listMessages,
  updateFolder,
  updateNote,
} from "./db";

describe("base existante", () => {
  it("ajoute la colonne des dossiers sans toucher aux notes", () => {
    expect(getNote("ancienne")).toMatchObject({ title: "Ancienne note", folderId: null });
  });
});

describe("dossiers", () => {
  it("forme un arbre, et refuse qu'un dossier aille dans un de ses sous-dossiers", () => {
    const projet = createFolder({ name: "VPS" });
    const sous = createFolder({ name: "Caddy", parentId: projet.id });
    const sousSous = createFolder({ name: "Certificats", parentId: sous.id });
    expect(folderChain(sousSous.id).map((f) => f.name)).toEqual(["Certificats", "Caddy", "VPS"]);
    expect(isInside(sousSous.id, projet.id)).toBe(true);
    expect(isInside(projet.id, projet.id)).toBe(true);
    expect(isInside(projet.id, sous.id)).toBe(false);
  });

  it("à la suppression, remonte notes, discussions et sous-dossiers dans le parent", () => {
    const projet = createFolder({ name: "Projet" });
    const dossier = createFolder({ name: "À supprimer", parentId: projet.id });
    const sous = createFolder({ name: "Sous", parentId: dossier.id });
    const note = createNote({ title: "Note", folderId: dossier.id });
    const discussion = createConversation({ folderId: dossier.id });
    expect(deleteFolder(dossier.id)).toBe(true);
    expect(getNote(note.id)?.folderId).toBe(projet.id);
    expect(getConversation(discussion.id)?.folderId).toBe(projet.id);
    expect(listFolders().find((f) => f.id === sous.id)?.parentId).toBe(projet.id);
    expect(deleteFolder(dossier.id)).toBe(false);
  });

  it("déplace une note et un dossier, et null veut dire la racine", () => {
    const a = createFolder({ name: "A" });
    const note = createNote({ title: "N" });
    expect(updateNote(note.id, { folderId: a.id })?.folderId).toBe(a.id);
    expect(updateNote(note.id, { title: "Renommée" })?.folderId).toBe(a.id);
    expect(updateNote(note.id, { folderId: null })?.folderId).toBeNull();
    const old = updateNote(note.id, { title: "Ancienne" })!.updatedAt;
    expect(updateNote(note.id, { folderId: a.id })?.updatedAt).toBe(old);
    const b = createFolder({ name: "B", parentId: a.id });
    expect(updateFolder(b.id, { parentId: null })?.parentId).toBeNull();
    expect(updateFolder(b.id, { instructions: "Réponds en français" })).toMatchObject({ parentId: null, name: "B", instructions: "Réponds en français" });
  });
});

describe("discussions", () => {
  it("garde les messages dans l'ordre, et les supprime avec la discussion", () => {
    const c = createConversation({ title: "Test", contextNoteIds: ["x", "y"] });
    for (let i = 0; i < 5; i++) addMessage(c.id, { role: i % 2 ? "assistant" : "user", content: `m${i}` });
    expect(listMessages(c.id).map((m) => m.content)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(getConversation(c.id)?.contextNoteIds).toEqual(["x", "y"]);
    expect(deleteConversation(c.id)).toBe(true);
    expect(listMessages(c.id)).toEqual([]);
  });
});
