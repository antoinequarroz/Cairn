import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cairn-note-search-"));
});

import { createFolder, createNote, updateNote } from "./db";
import { findNotes } from "./note-search";

const ids = (q: string, opts?: Parameters<typeof findNotes>[1]) => findNotes(q, opts).notes.map((n) => n.id);

describe("recherche dans les notes pour l'IA", () => {
  const vps = createFolder({ name: "VPS" });
  const caddyFolder = createFolder({ name: "Caddy", parentId: vps.id });
  const caddy = createNote({ title: "Config Caddy", content: "reverse_proxy 172.17.0.1:3020 pour Cairn", folderId: caddyFolder.id });
  const ssh = createNote({ title: "Accès SSH", content: "ssh antoine-vps, port 2222, clé ed25519", folderId: vps.id });
  const recette = createNote({ title: "Recette", content: "Tarte aux pommes et caddy du supermarché" });
  const vide = createNote({ title: "Caddy (vide)", content: "" });
  const secrete = createNote({ title: "Clés Caddy", content: "x" });
  updateNote(secrete.id, { content: "bloc-chiffre-illisible", encrypted: true });

  it("trouve à partir d'une question en langage courant, meilleure note d'abord, avec son dossier", () => {
    const { notes, terms } = findNotes("Qu'est-ce que j'ai noté sur Caddy ?");
    expect(terms).toEqual(["caddy"]);
    expect(notes[0]).toMatchObject({ id: caddy.id, path: "VPS / Caddy", content: "reverse_proxy 172.17.0.1:3020 pour Cairn" });
    expect(notes.map((n) => n.id)).toContain(recette.id);
  });

  it("ne renvoie jamais une note chiffrée, même trouvée par son titre, ni une note vide", () => {
    const found = ids("caddy clés");
    expect(found).not.toContain(secrete.id);
    expect(found).not.toContain(vide.id);
    expect(JSON.stringify(findNotes("chiffre illisible caddy clés"))).not.toContain("bloc-chiffre-illisible");
  });

  it("cherche dans un dossier et ses sous-dossiers, et laisse de côté les notes déjà épinglées", () => {
    expect(ids("caddy", { folderId: vps.id })).toEqual([caddy.id]);
    expect(ids("caddy ssh", { folderId: vps.id }).sort()).toEqual([caddy.id, ssh.id].sort());
    expect(ids("caddy", { exclude: [caddy.id] })).toEqual([recette.id]);
  });

  it("reprend les mots de la question d'avant pour une relance", () => {
    expect(ids("Et le port ?")).toEqual([ssh.id]);
    expect(ids("Et sinon ?", { previous: "Comment je me connecte en SSH ?" })).toEqual([ssh.id]);
  });

  it("ne lit aucune syntaxe FTS dans la question", () => {
    expect(ids('NEAR(caddy) OR "* -- ^')).toEqual(ids("caddy"));
    expect(ids("?!")).toEqual([]);
  });
});
