import { strToU8, zipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cairn-import-"));
});

import { FILES_DIR, getFile, getNote, listFolders, listNotes } from "./db";
import { cleanName, csvToMarkdown, ImportError, importZip, rewriteLinks, splitTitle } from "./import";
import { search } from "./search";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const ID = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d";
const ID2 = "aaaabbbbccccddddeeeeffff00001111";

const noteByTitle = (title: string) => {
  const s = listNotes().find((n) => n.title === title);
  return s ? getNote(s.id)! : null;
};
const folderNamed = (name: string) => listFolders().find((f) => f.name === name);

describe("morceaux", () => {
  it("retire les identifiants de Notion", () => {
    expect(cleanName(`Réunion du lundi ${ID}`)).toBe("Réunion du lundi");
    expect(cleanName("Notes")).toBe("Notes");
  });

  it("prend le premier titre comme titre de la note", () => {
    expect(splitTitle("﻿# Projet VPS\n\nTexte", "x")).toEqual({ title: "Projet VPS", content: "Texte" });
    expect(splitTitle("Pas de titre", "fichier")).toEqual({ title: "fichier", content: "Pas de titre" });
  });

  it("change un CSV en tableau", () => {
    expect(csvToMarkdown('﻿Nom,Statut\n"Caddy, proxy",Fait\nHermes,"en ""test"""\n')).toBe(
      '| Nom | Statut |\n| --- | --- |\n| Caddy, proxy | Fait |\n| Hermes | en "test" |\n',
    );
  });

  it("réécrit les liens relatifs, laisse les autres", () => {
    const md = "![](img%20a.png) [doc](<Sous dossier/b.md>) [web](https://x.ch) [ancre](#haut) ![t](c.png \"titre\")";
    const out = rewriteLinks(md, "dir", (t) => ({ "dir/img a.png": "/api/files/1", "dir/Sous dossier/b.md": "/notes/2", "dir/c.png": "/api/files/3" })[t]);
    expect(out).toBe('![](/api/files/1) [doc](/notes/2) [web](https://x.ch) [ancre](#haut) ![t](/api/files/3 "titre")');
  });
});

describe("import d'un export Notion", () => {
  const exportZip = zipSync({
    [`Export-0d3c5e7a-1111-2222-3333-444455556666/Homelab ${ID}.md`]: strToU8(
      `# Homelab\n\nVoir [Caddy](Homelab%20${ID}/Caddy%20${ID2}.md).\n\n![schéma](Homelab%20${ID}/sch%C3%A9ma.png)\n`,
    ),
    [`Export-0d3c5e7a-1111-2222-3333-444455556666/Homelab ${ID}/Caddy ${ID2}.md`]: strToU8(`# Caddy\n\nReverse proxy pour cairn.\n\n![](Caddy%20${ID2}/Untitled.png)`),
    [`Export-0d3c5e7a-1111-2222-3333-444455556666/Homelab ${ID}/schéma.png`]: PNG,
    [`Export-0d3c5e7a-1111-2222-3333-444455556666/Homelab ${ID}/Caddy ${ID2}/Untitled.png`]: PNG,
    [`Export-0d3c5e7a-1111-2222-3333-444455556666/Homelab ${ID}/Caddy ${ID2}/inutilise.png`]: PNG,
    [`Export-0d3c5e7a-1111-2222-3333-444455556666/Tâches ${ID2}.csv`]: strToU8("Nom,Statut\nSauvegardes,Fait\n"),
    [`Export-0d3c5e7a-1111-2222-3333-444455556666/Tâches ${ID2}_all.csv`]: strToU8("Nom,Statut\nSauvegardes,Fait\nRecherche,En cours\n"),
    "__MACOSX/._x.md": strToU8("bruit"),
  });
  // Notion découpe les gros exports en parties, zippées dans le zip.
  const zip = zipSync({ "Export-0d3c5e7a-Part-1.zip": exportZip });

  it("recrée les dossiers, les notes, les images et les liens", () => {
    const report = importZip(zip, { name: "Export-0d3c5e7a.zip", folderId: null });
    expect(report).toMatchObject({ notes: 3, files: 2 });

    const root = listFolders().find((f) => f.id === report.folderId)!;
    expect(root.name).toBe("Import Notion");
    const homelab = folderNamed("Homelab")!;
    expect(homelab.parentId).toBe(root.id);

    const page = noteByTitle("Homelab")!;
    const caddy = noteByTitle("Caddy")!;
    // Une page avec des sous-pages va dans le dossier du même nom, avec elles.
    expect(page.folderId).toBe(homelab.id);
    expect(caddy.folderId).toBe(homelab.id);
    expect(page.content).toContain(`[Caddy](/notes/${caddy.id})`);
    const image = page.content.match(/!\[schéma\]\(\/api\/files\/([\w-]+)\)/)![1];
    expect(getFile(image)).toMatchObject({ name: "schéma.png", mime: "image/png" });
    expect(fs.readFileSync(path.join(FILES_DIR, image))).toEqual(Buffer.from(PNG));
    expect(caddy.content).toMatch(/^Reverse proxy pour cairn\.\n\n!\[\]\(\/api\/files\/[\w-]+\)$/);

    // La base garde toutes ses lignes (le _all.csv), en tableau.
    const taches = noteByTitle("Tâches")!;
    expect(taches.folderId).toBe(root.id);
    expect(taches.content).toContain("| Recherche | En cours |");

    // Et tout est cherchable tout de suite.
    expect(search("reverse proxy").map((r) => r.id)).toContain(caddy.id);
  });
});

describe("import d'un dossier Markdown", () => {
  it("garde le nom du dossier choisi, et sa structure", () => {
    const zip = zipSync({
      "Notes/lisez-moi.md": strToU8("Pas de titre ici."),
      "Notes/Travail/réunion.md": strToU8("# Réunion\n\n[retour](../lisez-moi.md)"),
    });
    const report = importZip(zip, { name: "dossier.zip", folderId: null });
    expect(listFolders().find((f) => f.id === report.folderId)?.name).toBe("Notes");
    const reunion = noteByTitle("Réunion")!;
    expect(listFolders().find((f) => f.id === reunion.folderId)?.name).toBe("Travail");
    expect(reunion.content).toBe(`[retour](/notes/${noteByTitle("lisez-moi")!.id})`);
  });

  it("refuse une archive sans note, et ne laisse aucun chemin sortir", () => {
    expect(() => importZip(zipSync({ "photo.png": PNG }), { name: "x.zip", folderId: null })).toThrow(ImportError);
    expect(() => importZip(strToU8("pas un zip"), { name: "x.zip", folderId: null })).toThrow(ImportError);
    const report = importZip(zipSync({ "a.md": strToU8("![](../../../etc/passwd)") }), { name: "x.zip", folderId: null });
    expect(report.files).toBe(0);
  });
});
