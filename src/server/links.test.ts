import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cairn-links-"));
});

import { GET } from "@/app/api/links/route";
import { createNote, updateNote } from "./db";

const EVENT = "https://alfred.postmelo.ch/events/12";

describe("notes liées à une page de la suite", () => {
  const meeting = createNote({ title: "Point projet", content: `[Point projet](${EVENT})\n\n## Notes` });
  createNote({ title: "Autre événement", content: `[x](${EVENT}3) et ${EVENT}/edit` });
  const locked = createNote({ title: "Secret", content: "" });
  updateNote(locked.id, { content: "blob", encrypted: true });

  it("finds the notes that link to the page, titles and addresses only", async () => {
    vi.stubEnv("APP_URL", "https://cairn.postmelo.ch");
    const res = await GET(new Request(`http://cairn.test/api/links?url=${encodeURIComponent(EVENT)}`));
    const { notes } = await res.json();
    expect(notes).toEqual([{ id: meeting.id, title: "Point projet", updatedAt: meeting.updatedAt, url: `https://cairn.postmelo.ch/notes/${meeting.id}` }]);
    vi.unstubAllEnvs();
  });

  it("refuses an address that isn't one", async () => {
    expect((await GET(new Request("http://cairn.test/api/links?url=nope"))).status).toBe(400);
  });
});
