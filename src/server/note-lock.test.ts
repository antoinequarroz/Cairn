import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cairn-lock-"));
});

import { createNote, db, updateNote } from "./db";

const files = () => ["cairn.db", "cairn.db-wal"].map((f) => path.join(process.env.DATA_DIR!, f)).filter((f) => fs.existsSync(f));
const onDisk = (needle: string) => files().some((f) => fs.readFileSync(f).includes(Buffer.from(needle)));

describe("note verrouillée après coup", () => {
  it("son texte en clair ne reste ni dans la base ni dans le journal", () => {
    const secret = "clef-privee-ed25519-AAAAC3NzaC1lZDI1NTE5-tres-secrete";
    const note = createNote({ title: "Serveur", content: `Ma clé : ${secret}\n`.repeat(20) });
    // Several writes, as the autosave does, so the clear text lands in more than one page version.
    updateNote(note.id, { content: `Ma clé : ${secret} (modifiée)\n`.repeat(20) });
    expect(onDisk(secret)).toBe(true);

    updateNote(note.id, { content: "v1.aXY=.Y2hpZmZyw6k=", encrypted: true });
    expect(db().pragma("secure_delete", { simple: true })).toBe(1);
    expect(onDisk(secret)).toBe(false);
  });
});
