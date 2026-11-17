import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cairn-settings-"));
});

import { aiEnv, aiSecrets, aiSettingsView, updateAiSettings } from "./ai-settings";
import { db } from "./db";
import { streamAnswer } from "./ai";
import { open, seal } from "./secret-box";

const DIR = process.env.DATA_DIR!;
const rawSettings = () => (db().prepare("select value from settings where key = 'ai'").get() as { value: string } | undefined)?.value ?? "";

beforeEach(() => {
  db().prepare("delete from settings").run();
  for (const name of ["AI_PROVIDER", "HERMES_URL", "HERMES_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "OPENAI_API_KEY", "CAIRN_SECRET"]) vi.stubEnv(name, "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("coffret des secrets du serveur", () => {
  it("chiffre, déchiffre, et refuse un bloc modifié", () => {
    const sealed = seal("cle-de-test-ffff");
    expect(sealed).not.toContain("cle-de-test");
    expect(open(sealed)).toBe("cle-de-test-ffff");
    const [v, iv, data] = sealed.split(".");
    const flipped = `${v}.${iv}.${data[0] === "A" ? "B" : "A"}${data.slice(1)}`;
    expect(open(flipped)).toBeNull();
    expect(open("n'importe quoi")).toBeNull();
  });

  it("garde sa clé dans secret.key, lisible par l'app seule", () => {
    seal("x");
    const stat = fs.statSync(path.join(DIR, "secret.key"));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("utilise CAIRN_SECRET quand il est défini, et ne lit plus ce qui a été scellé autrement", () => {
    const withFile = seal("a");
    vi.stubEnv("CAIRN_SECRET", "phrase-de-test");
    const withEnv = seal("b");
    expect(open(withEnv)).toBe("b");
    expect(open(withFile)).toBeNull();
  });
});

describe("réglages de l'IA", () => {
  it("garde les clés chiffrées et ne les renvoie jamais", () => {
    expect(updateAiSettings({ provider: "anthropic", providers: { anthropic: { secret: "cle-de-test-anthropic-aaaaa", model: "claude-sonnet-5-5" } } })).toBeNull();
    expect(rawSettings()).not.toContain("anthropic-aaaaa");
    const view = aiSettingsView();
    expect(JSON.stringify(view)).not.toContain("anthropic-aaaaa");
    expect(view.active).toEqual({ provider: "anthropic", ready: true, label: "Claude (claude-sonnet-5-5)" });
    expect(view.providers.find((p) => p.id === "anthropic")).toMatchObject({ configured: true, secretSource: "app", secretHint: "…aaaa", model: "claude-sonnet-5-5" });
    expect(aiSecrets()).toContain("cle-de-test-anthropic-aaaaa");
  });

  it("passe avant le .env, qui reste le repli", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "cle-de-test-env-aaaa");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-haiku-5-5");
    expect(aiSettingsView().providers.find((p) => p.id === "anthropic")).toMatchObject({ secretSource: "env", modelFallback: "claude-haiku-5-5" });
    updateAiSettings({ providers: { anthropic: { secret: "cle-de-test-app-bbbb" } } });
    expect(aiEnv().ANTHROPIC_API_KEY).toBe("cle-de-test-app-bbbb");
    expect(aiEnv().ANTHROPIC_MODEL).toBe("claude-haiku-5-5");
    updateAiSettings({ providers: { anthropic: { secret: null } } });
    expect(aiEnv().ANTHROPIC_API_KEY).toBe("cle-de-test-env-aaaa");
  });

  it("le choix fait dans l'app remplace AI_PROVIDER, « auto » compris", () => {
    vi.stubEnv("AI_PROVIDER", "hermes");
    vi.stubEnv("OPENAI_API_KEY", "o");
    expect(aiSettingsView()).toMatchObject({ provider: null, envProvider: "hermes", active: { provider: "hermes", ready: false } });
    updateAiSettings({ provider: "auto" });
    expect(aiSettingsView().active).toMatchObject({ provider: "openai", ready: true });
    updateAiSettings({ provider: null });
    expect(aiSettingsView().active.provider).toBe("hermes");
  });

  it("refuse ce qui ne peut pas marcher", () => {
    expect(updateAiSettings({ provider: "gemini" as never })).toBe("Fournisseur inconnu");
    expect(updateAiSettings({ providers: { "claude-code": { secret: "cle-de-test-cccc" } } } as never)).toBe("Fournisseur inconnu");
    expect(updateAiSettings({ providers: { openai: { url: "http://moi:mdp@exemple.ch/v1" } } })).toMatch(/sans identifiants/);
    expect(updateAiSettings({ providers: { anthropic: { url: "https://x" } } })).toMatch(/pas d'adresse/);
    expect(updateAiSettings({ providers: { anthropic: { model: "deux mots" } } })).toBe("Nom de modèle invalide");
    expect(updateAiSettings({ providers: { openai: { secret: "sk deux morceaux" } } })).toMatch(/espace/);
    expect(rawSettings()).toBe("");
  });

  it("signale une clé qui ne se déchiffre plus", () => {
    updateAiSettings({ providers: { openai: { secret: "cle-de-test-openai-dddd" } } });
    vi.stubEnv("CAIRN_SECRET", "autre-phrase-de-test");
    expect(aiSettingsView().providers.find((p) => p.id === "openai")).toMatchObject({ unreadable: true, configured: false, secretSource: null });
  });
});

describe("fournisseur choisi pour un test", () => {
  it("dit qu'il n'est pas configuré, même si un autre l'est", async () => {
    updateAiSettings({ provider: "anthropic", providers: { anthropic: { secret: "cle-de-test-eeeeeeee" } } });
    const error = await streamAnswer({ action: "summarize", text: "x" }, undefined, { provider: "openai" }).catch((e: Error) => e);
    expect((error as Error).message).toBe("OpenAI (gpt-5.1) n'est pas configuré");
  });
});
