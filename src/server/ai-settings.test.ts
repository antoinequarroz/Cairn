import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cairn-settings-"));
});

import { aiEnv, aiSecrets, aiSettingsView, saveCodexAuth, updateAiSettings } from "./ai-settings";
import { db } from "./db";
import { AiError, streamAnswer } from "./ai";
import { open, seal } from "./secret-box";

const DIR = process.env.DATA_DIR!;
const rawSettings = () => (db().prepare("select value from settings where key = 'ai'").get() as { value: string } | undefined)?.value ?? "";
const CODEX_AUTH = JSON.stringify({ tokens: { access_token: "acces-codex-secret", refresh_token: "r1" } });

beforeEach(() => {
  db().prepare("delete from settings").run();
  for (const name of ["AI_PROVIDER", "HERMES_URL", "HERMES_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_AUTH_JSON", "CAIRN_SECRET"]) vi.stubEnv(name, "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("coffret des secrets du serveur", () => {
  it("chiffre, déchiffre, et refuse un bloc modifié", () => {
    const sealed = seal("sk-ant-api-123");
    expect(sealed).not.toContain("sk-ant");
    expect(open(sealed)).toBe("sk-ant-api-123");
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
    vi.stubEnv("CAIRN_SECRET", "une-phrase-secrete");
    const withEnv = seal("b");
    expect(open(withEnv)).toBe("b");
    expect(open(withFile)).toBeNull();
  });
});

describe("réglages de l'IA", () => {
  it("garde les clés chiffrées et ne les renvoie jamais", () => {
    expect(updateAiSettings({ provider: "anthropic", providers: { anthropic: { secret: "sk-ant-api03-clef-tres-secrete", model: "claude-sonnet-5-5" } } })).toBeNull();
    expect(rawSettings()).not.toContain("clef-tres-secrete");
    const view = aiSettingsView();
    expect(JSON.stringify(view)).not.toContain("clef-tres-secrete");
    expect(view.active).toEqual({ provider: "anthropic", ready: true, label: "Claude (claude-sonnet-5-5)" });
    expect(view.providers.find((p) => p.id === "anthropic")).toMatchObject({ configured: true, secretSource: "app", secretHint: "…rete", model: "claude-sonnet-5-5" });
    expect(aiSecrets()).toContain("sk-ant-api03-clef-tres-secrete");
  });

  it("passe avant le .env, qui reste le repli", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "clef-du-env-0000");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-haiku-5-5");
    expect(aiSettingsView().providers.find((p) => p.id === "anthropic")).toMatchObject({ secretSource: "env", modelFallback: "claude-haiku-5-5" });
    updateAiSettings({ providers: { anthropic: { secret: "clef-de-l-app-1111" } } });
    expect(aiEnv().ANTHROPIC_API_KEY).toBe("clef-de-l-app-1111");
    expect(aiEnv().ANTHROPIC_MODEL).toBe("claude-haiku-5-5");
    updateAiSettings({ providers: { anthropic: { secret: null } } });
    expect(aiEnv().ANTHROPIC_API_KEY).toBe("clef-du-env-0000");
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
    expect(updateAiSettings({ providers: { "claude-code": { secret: "sk-ant-api03-abc" } } })).toMatch(/clé d'API/);
    expect(updateAiSettings({ providers: { codex: { secret: "pas du json" } } })).toMatch(/auth.json/);
    expect(updateAiSettings({ providers: { openai: { url: "http://moi:mdp@exemple.ch/v1" } } })).toMatch(/sans identifiants/);
    expect(updateAiSettings({ providers: { anthropic: { url: "https://x" } } })).toMatch(/pas d'adresse/);
    expect(updateAiSettings({ providers: { anthropic: { model: "deux mots" } } })).toBe("Nom de modèle invalide");
    expect(updateAiSettings({ providers: { openai: { secret: "sk deux morceaux" } } })).toMatch(/espace/);
    expect(rawSettings()).toBe("");
  });

  it("signale une clé qui ne se déchiffre plus", () => {
    updateAiSettings({ providers: { openai: { secret: "sk-openai-0123456789" } } });
    vi.stubEnv("CAIRN_SECRET", "autre-secret");
    expect(aiSettingsView().providers.find((p) => p.id === "openai")).toMatchObject({ unreadable: true, configured: false, secretSource: null });
  });

  it("met à jour la connexion Codex renouvelée", () => {
    updateAiSettings({ providers: { codex: { secret: CODEX_AUTH } } });
    saveCodexAuth('{"tokens":{"access_token":"nouveau"}}');
    expect(aiEnv().CODEX_AUTH_JSON).toBe('{"tokens":{"access_token":"nouveau"}}');
  });
});

// --- The subscription providers, with fake command line tools ------------------------------------

const BIN = fs.mkdtempSync(path.join(os.tmpdir(), "cairn-bin-"));
const tool = (name: string, script: string) => fs.writeFileSync(path.join(BIN, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });

async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += new TextDecoder().decode(value);
  }
}

const INPUT = { action: "summarize", text: "Une note sur Cairn.", title: "Test" } as const;

describe("abonnements : Claude Code et Codex", () => {
  beforeEach(() => vi.stubEnv("PATH", `${BIN}:${process.env.PATH}`));

  it("Claude Code reçoit la note sur son entrée, sans outils, avec le jeton et rien d'autre", async () => {
    tool(
      "claude",
      `input=$(cat)
printf '%s\\n' "$@" > "${BIN}/claude.args"
env > "${BIN}/claude.env"
echo '{"type":"system","subtype":"init"}'
printf '%s\\n' '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Résumé "}}}'
printf '%s\\n' '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"court"}}}'
printf '%s\\n' '{"type":"result","subtype":"success","is_error":false}'
case "$input" in *"Une note sur Cairn."*) ;; *) exit 3 ;; esac`,
    );
    vi.stubEnv("APP_PASSWORD", "mot-de-passe-de-l-app");
    updateAiSettings({ provider: "claude-code", providers: { "claude-code": { secret: "sk-ant-oat01-jeton" } } });
    expect(await drain(await streamAnswer(INPUT))).toBe("Résumé court");
    const args = fs.readFileSync(path.join(BIN, "claude.args"), "utf8").split("\n");
    expect(args).toEqual(expect.arrayContaining(["-p", "stream-json", "--include-partial-messages", "--tools", "", "--model", "sonnet", "--no-session-persistence"]));
    const env = fs.readFileSync(path.join(BIN, "claude.env"), "utf8");
    expect(env).toContain("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-jeton");
    expect(env).not.toContain("mot-de-passe-de-l-app");
  });

  it("Claude Code : son erreur est rendue, sans le jeton", async () => {
    tool("claude", `cat > /dev/null; printf '%s\\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["Token sk-ant-oat01-jeton expired"]}'; exit 1`);
    updateAiSettings({ provider: "claude-code", providers: { "claude-code": { secret: "sk-ant-oat01-jeton" } } });
    const error = await streamAnswer(INPUT).catch((e: Error) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as Error).message).toBe("Claude, abonnement (sonnet) : Token … expired");
  });

  it("Codex : la réponse, la connexion renouvelée gardée, et auth.json effacé après", async () => {
    tool(
      "codex",
      `cat > /dev/null
grep -q acces-codex-secret "$CODEX_HOME/auth.json" || exit 4
printf '%s\\n' '{"tokens":{"access_token":"renouvele","refresh_token":"r2"}}' > "$CODEX_HOME/auth.json"
printf '%s\\n' '{"type":"turn.started"}' '{"type":"error","message":"Reconnecting... 1/5"}' '{"type":"item.completed","item":{"type":"agent_message","text":"Résumé Codex"}}' '{"type":"turn.completed"}'`,
    );
    updateAiSettings({ provider: "codex", providers: { codex: { secret: CODEX_AUTH } } });
    expect(await drain(await streamAnswer(INPUT))).toBe("Résumé Codex");
    await vi.waitFor(() => expect(fs.existsSync(path.join(DIR, "ai", "codex", "auth.json"))).toBe(false));
    expect(aiEnv().CODEX_AUTH_JSON).toContain("renouvele");
  });

  it("dit clairement quand l'outil n'est pas installé", async () => {
    vi.stubEnv("PATH", "/nonexistent");
    updateAiSettings({ provider: "codex", providers: { codex: { secret: CODEX_AUTH } } });
    const error = await streamAnswer(INPUT).catch((e: Error) => e);
    expect((error as Error).message).toBe("Codex (codex) n'est pas installé sur le serveur. Voir docs/IA.md.");
    expect(fs.existsSync(path.join(DIR, "ai", "codex", "auth.json"))).toBe(false);
  });

  it("un fournisseur choisi pour un test, même s'il n'est pas celui utilisé", async () => {
    updateAiSettings({ provider: "anthropic", providers: { anthropic: { secret: "sk-ant-api03-xxxxxxxx" } } });
    const error = await streamAnswer(INPUT, undefined, { provider: "codex" }).catch((e: Error) => e);
    expect((error as Error).message).toBe("Codex n'est pas configuré");
  });
});
