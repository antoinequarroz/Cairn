// The AI providers set up in Réglages > IA. They win over the .env, which stays the fallback:
// a field left empty in the app takes the value of the .env.
//
// Keys and tokens are sealed in the database (secret-box) and never sent back to the browser:
// the settings page only learns whether a key is there, where it comes from, and its last characters.
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MODELS, ENV_PREFIX, isProvider, pickProvider, PROVIDERS, providerConfigured, type ProviderId } from "@/lib/ai";
import type { AiProviderView, AiSettingsUpdate, AiSettingsView } from "@/lib/ai-settings";
import { getSetting, setSetting } from "./db";
import { open, seal } from "./secret-box";

type StoredProvider = { model?: string; url?: string; secret?: string };
type Stored = { provider?: "auto" | ProviderId; providers?: Partial<Record<ProviderId, StoredProvider>> };

const KEY = "ai";

/** The environment variable that holds each provider's secret, and its address when it has one. */
export const SECRET_VAR: Record<ProviderId, string> = {
  hermes: "HERMES_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  "claude-code": "CLAUDE_CODE_OAUTH_TOKEN",
  codex: "CODEX_AUTH_JSON",
};
export const URL_VAR: Partial<Record<ProviderId, string>> = { hermes: "HERMES_URL", openai: "OPENAI_BASE_URL" };

const stored = (): Stored => getSetting<Stored>(KEY) ?? {};

/** Secrets that could not be opened (CAIRN_SECRET changed, secret.key lost): shown in Réglages. */
function unsealed(s: Stored) {
  const secrets: Partial<Record<ProviderId, string>> = {};
  const unreadable: ProviderId[] = [];
  for (const p of PROVIDERS) {
    const sealed = s.providers?.[p]?.secret;
    if (!sealed) continue;
    const plain = open(sealed);
    if (plain === null) unreadable.push(p);
    else secrets[p] = plain;
  }
  return { secrets, unreadable };
}

/**
 * The settings in effect, in the shape of environment variables: the .env, overlaid with what was
 * entered in the app. Everything that reads AI settings goes through this.
 */
export function aiEnv(): Record<string, string | undefined> {
  const s = stored();
  const { secrets } = unsealed(s);
  const env: Record<string, string | undefined> = { ...process.env };
  if (s.provider) env.AI_PROVIDER = s.provider;
  for (const p of PROVIDERS) {
    const conf = s.providers?.[p];
    if (secrets[p]?.trim()) env[SECRET_VAR[p]] = secrets[p];
    if (conf?.model?.trim()) env[`${ENV_PREFIX[p]}_MODEL`] = conf.model.trim();
    const urlVar = URL_VAR[p];
    if (urlVar && conf?.url?.trim()) env[urlVar] = conf.url.trim();
  }
  return env;
}

/** Every secret in use, from the app or the .env: none may appear in an error message. */
export function aiSecrets(): string[] {
  const env = aiEnv();
  return PROVIDERS.map((p) => env[SECRET_VAR[p]]?.trim()).filter((v): v is string => !!v);
}

function onPath(command: string) {
  return (process.env.PATH ?? "").split(path.delimiter).some((dir) => {
    try {
      fs.accessSync(path.join(dir, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

const hint = (p: ProviderId, secret: string) => (p === "codex" ? null : secret.length > 12 ? `…${secret.slice(-4)}` : "…");

export function aiSettingsView(): AiSettingsView {
  const s = stored();
  const { secrets, unreadable } = unsealed(s);
  const env = aiEnv();
  const providers = PROVIDERS.map((p): AiProviderView => {
    const conf = s.providers?.[p] ?? {};
    const fromEnv = process.env[SECRET_VAR[p]]?.trim();
    const fromApp = secrets[p]?.trim();
    const urlVar = URL_VAR[p];
    return {
      id: p,
      configured: providerConfigured(p, env),
      secretSource: fromApp ? "app" : fromEnv ? "env" : null,
      secretHint: fromApp ? hint(p, fromApp) : fromEnv ? hint(p, fromEnv) : null,
      unreadable: unreadable.includes(p),
      model: conf.model ?? "",
      modelFallback: process.env[`${ENV_PREFIX[p]}_MODEL`]?.trim() || DEFAULT_MODELS[p],
      url: urlVar ? (conf.url ?? "") : undefined,
      urlFallback: urlVar ? (process.env[urlVar]?.trim() ?? "") : undefined,
      cli: p === "claude-code" ? onPath("claude") : p === "codex" ? onPath("codex") : undefined,
    };
  });
  const active = pickProvider(env);
  return {
    provider: s.provider ?? null,
    envProvider: process.env.AI_PROVIDER?.trim() || null,
    active: { provider: active.provider, ready: active.ready, label: active.label },
    providers,
  };
}

const MAX_SECRET = 20_000;
const MAX_FIELD = 300;

/** Checks a secret before it is stored. Returns the French reason it is refused, or null. */
export function checkSecret(p: ProviderId, value: string): string | null {
  if (value.length > MAX_SECRET) return "Valeur trop longue";
  if (/\s/.test(value.trim()) && p !== "codex") return "Une clé ne contient pas d'espace : vérifie le copier-coller";
  if (p === "claude-code" && value.trim().startsWith("sk-ant-api")) return "C'est une clé d'API : elle va dans « Claude (clé d'API) ». Ici, il faut le jeton de « claude setup-token » (sk-ant-oat…).";
  if (p === "codex") {
    try {
      const j = JSON.parse(value) as Record<string, unknown>;
      if (!j || typeof j !== "object" || !(j.tokens || j.OPENAI_API_KEY)) throw new Error();
    } catch {
      return "Colle le contenu complet du fichier ~/.codex/auth.json (du JSON, avec « tokens »)";
    }
  }
  return null;
}

/** Applies a change from Réglages. Returns the French reason it is refused, or null. */
export function updateAiSettings(u: AiSettingsUpdate): string | null {
  const s = stored();
  const next: Stored = { provider: s.provider, providers: { ...s.providers } };
  if (u.provider !== undefined) {
    if (u.provider !== null && u.provider !== "auto" && !isProvider(u.provider)) return "Fournisseur inconnu";
    next.provider = u.provider ?? undefined;
  }
  for (const [id, change] of Object.entries(u.providers ?? {})) {
    if (!isProvider(id) || !change) return "Fournisseur inconnu";
    const conf: StoredProvider = { ...next.providers![id] };
    if (change.model !== undefined) {
      if (typeof change.model !== "string" || change.model.length > MAX_FIELD || /\s/.test(change.model.trim())) return "Nom de modèle invalide";
      conf.model = change.model.trim() || undefined;
    }
    if (change.url !== undefined) {
      if (!URL_VAR[id]) return "Ce fournisseur n'a pas d'adresse";
      if (typeof change.url !== "string" || change.url.length > MAX_FIELD) return "Adresse invalide";
      const url = change.url.trim();
      if (url) {
        let ok = false;
        try {
          const parsed = new URL(url);
          ok = /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password;
        } catch {}
        if (!ok) return "Il faut une adresse http(s) complète, sans identifiants";
      }
      conf.url = url || undefined;
    }
    if (change.secret !== undefined) {
      if (change.secret === null || change.secret === "") conf.secret = undefined;
      else {
        if (typeof change.secret !== "string") return "Valeur invalide";
        const why = checkSecret(id, change.secret);
        if (why) return why;
        conf.secret = seal(change.secret.trim());
      }
    }
    next.providers![id] = conf;
  }
  setSetting(KEY, next);
  return null;
}

/** Codex refreshes its tokens and rewrites auth.json: keep the new one, sealed. */
export function saveCodexAuth(json: string) {
  const s = stored();
  const conf = s.providers?.codex;
  if (!conf?.secret) return; // removed meanwhile, or it came from the .env: nothing to update
  setSetting(KEY, { ...s, providers: { ...s.providers, codex: { ...conf, secret: seal(json) } } });
}
