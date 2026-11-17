import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cairn-vault-"));
});

import { POST } from "@/app/api/vault/items/route";
import { createVaultMeta, listVaultItems } from "./db";

const post = (json: unknown) => POST(new Request("http://x/api/vault/items", { method: "POST", body: JSON.stringify(json) }));

describe("import dans le coffre", () => {
  it("refuse tant que le coffre n'existe pas", async () => {
    expect((await post({ items: ["v1.a.b"] })).status).toBe(409);
  });

  it("ajoute un lot d'éléments chiffrés, et refuse tout lot qui contient du texte en clair", async () => {
    createVaultMeta({ v: 1, kdf: { name: "argon2id", salt: "c2Fs", memoryKiB: 1024, iterations: 1, parallelism: 1 }, wrappedKey: "v1.a.b" });
    expect((await post({ items: ["v1.a.b", "mot de passe en clair"] })).status).toBe(400);
    expect(listVaultItems()).toHaveLength(0);
    expect((await post({ items: [] })).status).toBe(400);
    expect((await post({ items: Array(501).fill("v1.a.b") })).status).toBe(400);

    const res = await post({ items: ["v1.a.1", "v1.a.2", "v1.a.3"] });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ added: 3 });
    expect(new Set(listVaultItems().map((i) => i.id)).size).toBe(3);
  });

  it("ajoute toujours un élément seul", async () => {
    expect((await post({ data: "v1.x.y" })).status).toBe(201);
    expect(listVaultItems()).toHaveLength(4);
  });
});
