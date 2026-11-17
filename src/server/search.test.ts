import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "cairn-search-"));
  process.env.DATA_DIR = dir;
  // A database from before the search: its notes must be found right away.
  const Database = (await import("better-sqlite3")).default;
  const old = new Database(join(dir, "cairn.db"));
  old.exec("create table notes (id text primary key, title text not null default '', content text not null default '', encrypted integer not null default 0, created_at text not null, updated_at text not null)");
  old.prepare("insert into notes values ('ancienne', 'Journal', 'Le certificat de Caddy expire en mars', 0, '2026-01-01', '2026-01-01')").run();
  old.close();
});

import { addMessage, createConversation, createFolder, createNote, db, deleteConversation, deleteNote, updateConversation, updateMessage, updateNote } from "./db";
import { ftsQuery, search } from "./search";

const ids = (q: string, folderId?: string) => search(q, { folderId }).map((r) => r.id);
const plain = (s: string) => s.replace(/[\u0001\u0002]/g, "");

describe("requête", () => {
  it("ne laisse passer aucune syntaxe FTS", () => {
    expect(ftsQuery("cadd")).toBe('"cadd"*');
    expect(ftsQuery('NEAR(a b) OR "x')).toBe('"NEAR"* "a"* "b"* "OR"* "x"*');
    expect(ftsQuery('"clé ssh" vps')).toBe('"clé ssh" "vps"*');
    expect(ftsQuery("  -- * ")).toBeNull();
  });
});

describe("recherche", () => {
  it("trouve les notes d'une base qui existait avant", () => {
    expect(ids("caddy")).toContain("ancienne");
  });

  it("cherche dans le titre et le contenu, sans accents, et surligne", () => {
    const n = createNote({ title: "Accès au VPS", content: "La clé ed25519 est dans le coffre. Port 2222." });
    expect(ids("acces")).toContain(n.id);
    expect(ids("ed255")).toContain(n.id);
    expect(ids("vps cle")).toContain(n.id);
    expect(ids("vps introuvable")).not.toContain(n.id);
    const hit = search("coffre").find((r) => r.id === n.id)!;
    expect(hit.snippet).toContain("\u0001coffre\u0002");
    expect(plain(hit.title)).toBe("Accès au VPS");
  });

  it("suit les modifications et les suppressions", () => {
    const n = createNote({ title: "Brouillon", content: "pommes" });
    updateNote(n.id, { content: "poires" });
    expect(ids("pommes")).not.toContain(n.id);
    expect(ids("poires")).toContain(n.id);
    deleteNote(n.id);
    expect(ids("poires")).not.toContain(n.id);
  });

  it("n'indexe jamais le contenu d'une note chiffrée, seulement son titre", () => {
    const n = createNote({ title: "Codes alarme", content: "le code est zanzibar" });
    expect(ids("zanzibar")).toContain(n.id);
    updateNote(n.id, { content: "v1.blob-chiffre", encrypted: true });
    expect(ids("zanzibar")).toEqual([]);
    expect(ids("chiffre")).not.toContain(n.id);
    expect(search("alarme").find((r) => r.id === n.id)).toMatchObject({ encrypted: true, snippet: "" });
    // Rien du texte clair ne reste dans l'index.
    const raw = db().prepare("select group_concat(title || ' ' || body, ' ') as all_text from search_fts").get() as { all_text: string };
    expect(raw.all_text).not.toContain("zanzibar");
    // Ni dans les segments de l'index, où FTS5 garde les mots supprimés jusqu'à une fusion.
    const left = db().prepare("select count(*) as n from search_fts_data where instr(block, cast('zanzibar' as blob)) > 0").get() as { n: number };
    expect(left.n).toBe(0);
  });

  it("trouve une discussion par son titre ou ses messages, une seule fois", () => {
    const c = createConversation({ title: "Plan de sauvegarde" });
    addMessage(c.id, { role: "user", content: "Comment chiffrer avec age ?" });
    const answer = addMessage(c.id, { role: "assistant", content: "", state: "streaming" });
    updateMessage(answer.id, { content: "Avec age et une clé publique, sauvegarde" });
    expect(ids("publique")).not.toContain(c.id); // pas pendant que la réponse s'écrit
    updateMessage(answer.id, { content: "Avec age et une clé publique, sauvegarde", state: "done" });
    expect(ids("publique")).toContain(c.id);
    expect(ids("sauvegarde").filter((id) => id === c.id)).toHaveLength(1);
    expect(search("chiffrer").find((r) => r.id === c.id)).toMatchObject({ kind: "conversation", title: "Plan de sauvegarde" });
    updateConversation(c.id, { title: "Sauvegardes Infomaniak" });
    expect(ids("infomaniak")).toContain(c.id);
    deleteConversation(c.id);
    expect(ids("publique")).toEqual([]);
  });

  it("se limite à un dossier et à ses sous-dossiers", () => {
    const projet = createFolder({ name: "Homelab" });
    const sous = createFolder({ name: "Réseau", parentId: projet.id });
    const ailleurs = createFolder({ name: "Perso" });
    const a = createNote({ title: "Wireguard", content: "tunnel", folderId: sous.id });
    const b = createNote({ title: "Vacances", content: "tunnel du Gothard", folderId: ailleurs.id });
    const c = createConversation({ title: "tunnel", folderId: projet.id });
    expect(ids("tunnel", projet.id).sort()).toEqual([a.id, c.id].sort());
    expect(ids("tunnel", ailleurs.id)).toEqual([b.id]);
    expect(ids("tunnel")).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
  });
});
