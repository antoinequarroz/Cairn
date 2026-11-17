import "server-only";
import fs from "node:fs";
import path from "node:path";
import {
  anthropicDelta,
  badProviderUrl,
  buildPrompt,
  claudeCodeDelta,
  codexDelta,
  createLineParser,
  createSseParser,
  describeProvider,
  openAiDelta,
  pickProvider,
  redactSecrets,
  type AiInput,
  type AiStatus,
  type Delta,
  type ProviderChoice,
  type ProviderId,
} from "@/lib/ai";
import { aiEnv, aiSecrets, saveCodexAuth } from "./ai-settings";
import { CliMissing, runCli, type CliRun } from "./cli";

/** An error whose message is safe and meant to be shown to the user, in French. */
export class AiError extends Error {}

export function aiStatus(): AiStatus {
  const { ready, provider, label } = pickProvider(aiEnv());
  return { ready, provider, label };
}

// The longest silence accepted from a provider, before its first byte and between two chunks. It is
// not a cap on the whole answer: a long translation may stream for many minutes. Hermes is an agent:
// it may call tools without a word, so it gets longer than a plain model. Codex hands its answer over
// in one piece at the end, so its silence lasts as long as it writes.
const TIMEOUT_MS: Record<ProviderId, number> = { hermes: 150_000, anthropic: 120_000, openai: 120_000, "claude-code": 150_000, codex: 600_000 };

type Http = { kind: "http"; url: string; headers: Record<string, string>; body: unknown; delta: (data: string) => Delta };
type Cli = { kind: "cli"; run: Omit<CliRun, "signal">; delta: (line: string) => Delta; before?: () => void; after?: () => void };
type Upstream = Http | Cli;

const DATA_DIR = () => path.resolve(process.env.DATA_DIR ?? "./data");

/** A home for each tool, in the data volume: their login and caches live there, not in the image. */
function toolDir(name: string) {
  const dir = path.join(DATA_DIR(), "ai", name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * What a tool receives from the environment: only what it needs to run and reach the network.
 * Never the app's own secrets (APP_PASSWORD, API_TOKEN, the other providers' keys).
 */
function toolEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { LANG: "C.UTF-8", NO_COLOR: "1" };
  for (const name of ["PATH", "TZ", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]) {
    const v = process.env[name];
    if (v) env[name] = v;
  }
  return { ...env, ...extra };
}

// Codex keeps its login in CODEX_HOME/auth.json and rewrites it when it refreshes the tokens. The file
// only exists while Codex runs: before, it is written from the sealed copy; after, a refreshed copy is
// sealed again and the file removed. Several runs at once share it.
let codexRuns = 0;

function codexUpstream(env: Record<string, string | undefined>, model: string, system: string, user: string): Cli {
  const home = toolDir("codex");
  const auth = path.join(home, "auth.json");
  const given = env.CODEX_AUTH_JSON!.trim();
  const args = ["exec", "--json", "--color", "never", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only", "-c", 'cli_auth_credentials_store="file"', "-C", toolDir("work")];
  if (model) args.push("--model", model);
  args.push("-");
  return {
    kind: "cli",
    // Codex has no separate system prompt in exec mode: Cairn's instructions come first, then the task.
    run: { command: "codex", args, stdin: `${system}\n\n---\n\n${user}`, env: toolEnv({ CODEX_HOME: home }), cwd: toolDir("work") },
    delta: codexDelta,
    before() {
      if (codexRuns++ === 0 || !fs.existsSync(auth)) fs.writeFileSync(auth, given, { mode: 0o600 });
    },
    after() {
      if (--codexRuns > 0) return;
      try {
        const now = fs.readFileSync(auth, "utf8").trim();
        if (now && now !== given) {
          JSON.parse(now);
          saveCodexAuth(now);
        }
      } catch {}
      fs.rmSync(auth, { force: true });
    },
  };
}

function upstream({ provider, model }: ProviderChoice, env: Record<string, string | undefined>, system: string, user: string): Upstream {
  const chat = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  if (provider === "claude-code") {
    return {
      kind: "cli",
      run: {
        command: "claude",
        // No tools, no settings, no MCP, no session kept: a plain question and its answer.
        args: ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model, "--system-prompt", system, "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"],
        stdin: user,
        env: toolEnv({
          HOME: toolDir("claude"),
          CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN!.trim(),
          DISABLE_AUTOUPDATER: "1",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        }),
        cwd: toolDir("work"),
      },
      delta: claudeCodeDelta,
    };
  }
  if (provider === "codex") return codexUpstream(env, model, system, user);
  if (provider === "hermes") {
    return {
      kind: "http",
      url: `${env.HERMES_URL!.trim().replace(/\/+$/, "")}/v1/chat/completions`,
      headers: { Authorization: `Bearer ${env.HERMES_API_KEY!.trim()}`, "X-Hermes-Session-Key": "cairn-notes" },
      body: { model, stream: true, messages: chat },
      delta: openAiDelta,
    };
  }
  if (provider === "openai") {
    return {
      kind: "http",
      url: `${(env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`,
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}` },
      body: { model, stream: true, messages: chat },
      delta: openAiDelta,
    };
  }
  // Anthropic Messages API. No `thinking`, effort or sampling fields: each model then runs with its
  // own defaults, so ANTHROPIC_MODEL can name any current model without a 400 on a field it rejects.
  const headers: Record<string, string> = { "x-api-key": env.ANTHROPIC_API_KEY!.trim(), "anthropic-version": "2026-10-21" };
  const body: Record<string, unknown> = { model, max_tokens: 64_000, stream: true, system, messages: [{ role: "user", content: user }] };
  // These models can decline a request through a safety classifier. With a fallback, the API retries
  // on the model Anthropic recommends, on the same stream, and the text simply carries on.
  if (/^claude-(fable|mythos|opus)-5(-|$)|^claude-sonnet-5-5$/.test(model)) {
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    body.fallbacks = "default";
  }
  return { kind: "http", url: "https://api.anthropic.com/v1/messages", headers, body, delta: anthropicDelta };
}

const CLI_NAMES: Partial<Record<ProviderId, string>> = { "claude-code": "Claude Code (claude)", codex: "Codex (codex)" };

/** Keys and URL credentials must never appear in an error message, whatever the upstream echoes back. */
const redact = (message: string) => redactSecrets(message, aiSecrets());

const short = (s: string) => redact(s.replace(/\s+/g, " ").trim()).slice(0, 200);

/**
 * Asks the configured provider and returns its answer as a stream of plain UTF-8 text.
 * Rejects with an AiError when nothing can be streamed: no provider, unreachable, HTTP error, or a
 * failure the provider reports inside its stream before any text (overload, quota, refusal, silence).
 * The route can then still answer with a real status and the reason. Once text has been handed over,
 * a failure can only cut the stream; its reason goes to the logs.
 * Aborting `signal` (the browser went away, or pressed Stop) cancels the upstream request too.
 */
export async function streamAnswer(input: AiInput, signal?: AbortSignal, options: { provider?: ProviderId } = {}): Promise<ReadableStream<Uint8Array>> {
  const env = aiEnv();
  const choice = options.provider ? describeProvider(options.provider, env) : pickProvider(env);
  if (!choice.ready || !choice.provider) throw new AiError(options.provider ? `${choice.label} n'est pas configuré` : "Aucune IA n'est configurée");
  const { system, user } = buildPrompt(input);
  const up = upstream(choice, env, system, user);
  // fetch refuses such an address with a message that quotes it, password included: say it plainly instead.
  if (up.kind === "http" && badProviderUrl(up.url)) throw new AiError(`L'adresse de ${choice.label} est invalide : il faut une adresse http(s) complète, sans identifiants (utilisateur:motdepasse@). Voir docs/IA.md.`);

  // Armed only while waiting on the provider (never while the browser is slow to read), so it
  // measures the provider's silence and nothing else.
  const idle = new AbortController();
  const limit = TIMEOUT_MS[choice.provider];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      idle.abort();
    }, limit);
  };
  const disarm = () => clearTimeout(timer);
  const abort = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;

  let source: ReadableStream<Uint8Array>;
  arm();
  if (up.kind === "cli") {
    up.before?.();
    try {
      source = await runCli({ ...up.run, signal: abort }, up.after);
    } catch (e) {
      disarm();
      if (e instanceof CliMissing) throw new AiError(`${CLI_NAMES[choice.provider]} n'est pas installé sur le serveur. Voir docs/IA.md.`);
      throw new AiError(`${choice.label} n'a pas pu démarrer (${short((e as Error)?.message ?? "erreur")})`);
    }
  } else {
    let res: Response;
    try {
      res = await fetch(up.url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...up.headers }, body: JSON.stringify(up.body), signal: abort, cache: "no-store" });
    } catch (e) {
      disarm();
      throw timedOut ? new AiError(`${choice.label} n'a pas répondu à temps`) : new AiError(`${choice.label} est injoignable (${short((e as Error)?.message ?? "erreur réseau")})`);
    }
    if (!res.ok || !res.body) {
      const detail = short(await res.text().catch(() => ""));
      disarm();
      throw new AiError(`${choice.label} a répondu ${res.status}${detail ? ` : ${detail}` : ""}`);
    }
    source = res.body;
  }
  disarm();

  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let produced = false; // by the current pump()
  let everProduced = false;
  let finished = false;
  let stopped = false;
  let failed = null as AiError | null;
  const fail = (error: AiError) => {
    finished = true;
    failed = error;
  };
  const onData = (data: string) => {
    if (finished) return;
    const d = up.delta(data);
    if (d.text) {
      controller.enqueue(encoder.encode(d.text));
      produced = everProduced = true;
    }
    if (d.stopped) stopped = true;
    if (d.error) fail(new AiError(`${choice.label} : ${short(d.error)}`));
    else if (d.done) finished = true;
  };
  const parser = up.kind === "cli" ? createLineParser(onData) : createSseParser(onData);

  // Reads the upstream until there is text to hand over, or until it ends. One upstream chunk may
  // hold no text at all (role, thinking, keep-alive): stopping there would make the stream look stalled.
  const pump = async () => {
    produced = false;
    try {
      while (!produced && !finished) {
        arm();
        const { done, value } = await reader.read().finally(disarm);
        if (done) {
          parser.end();
          // A clean end of connection without the provider's end marker is a cut, not a complete answer.
          if (!finished) {
            if (stopped) finished = true;
            else fail(new AiError(`${choice.label} a coupé la réponse avant la fin`));
          }
          break;
        }
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if (finished) return;
      if (timedOut) fail(new AiError(everProduced ? `${choice.label} a cessé de répondre` : `${choice.label} n'a pas répondu à temps`));
      else if (up.kind === "cli") fail(new AiError(`${choice.label} : ${short((e as Error)?.message ?? "erreur")}`));
      else fail(new AiError(`${choice.label} a coupé la connexion (${short((e as Error)?.message ?? "erreur réseau")})`));
    }
    if (finished) reader.cancel().catch(() => {});
  };

  // No read-ahead (highWaterMark 0): pull() then only runs when the consumer asks, never on its own
  // at construction, where it would race the first read below on the same reader.
  const stream = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c;
      },
      async pull() {
        if (!finished) {
          await pump();
          // Erroring a stream drops what it still holds: let this text go out, the end comes on the next pull.
          if (produced) return;
        }
        if (failed) {
          // The browser only sees a cut connection at this point: keep the reason in the logs.
          console.error(`[ia] ${failed.message}`);
          controller.error(failed);
        } else controller.close();
      },
      cancel() {
        finished = true;
        disarm();
        return reader.cancel().catch(() => {});
      },
    },
    { highWaterMark: 0 },
  );

  // Providers answer 200 and only then report an overload, a quota or a refusal inside the stream.
  // Waiting for the first text keeps those failures out of an already-sent 200.
  await pump();
  if (!everProduced) {
    if (failed) throw failed;
    if (finished) throw new AiError(`${choice.label} n'a rien répondu`);
  }
  return stream;
}
