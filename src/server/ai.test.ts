import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real package throws outside a server bundle. It guards imports, it is not behaviour to test.
vi.mock("server-only", () => ({}));

import { AiError, streamAnswer } from "./ai";

const INPUT = { action: "summarize", text: "Une note." } as const;
const text = (s: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;
const STOP = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
const DONE = "data: [DONE]\n\n";

type Step = string | number | "hang";

/**
 * A fake provider: answers 200 with the given SSE pieces, in order. A number waits that many
 * milliseconds, "hang" never sends anything more. Like the real fetch, the body fails when the
 * request is aborted.
 */
function provider(steps: Step[], init: ResponseInit = {}) {
  const calls: { url: string; signal: AbortSignal }[] = [];
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    const signal = options.signal!;
    calls.push({ url, signal });
    const queue = [...steps];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        signal.addEventListener("abort", () => c.error(signal.reason));
      },
      async pull(c) {
        for (;;) {
          const step = queue.shift();
          if (step === undefined) return c.close();
          if (step === "hang") return new Promise<void>(() => {});
          if (typeof step === "string") return c.enqueue(encoder.encode(step));
          await new Promise((r) => setTimeout(r, step));
        }
      },
    });
    return new Response(body, { status: 200, ...init });
  });
  return calls;
}

/** Reads the stream to its end: the text received, and the error that cut it, if any. */
async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let received = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { received, error: null };
      received += decoder.decode(value, { stream: true });
    }
  } catch (e) {
    return { received, error: e as Error };
  }
}

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "");
  vi.stubEnv("HERMES_URL", "http://hermes.test:8642");
  vi.stubEnv("HERMES_API_KEY", "clef-hermes-secrete");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("demande à l'IA : flux vers le navigateur", () => {
  it("rend le texte du fournisseur, dans l'ordre", async () => {
    const calls = provider(['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', text("Bon"), text("jour"), STOP, DONE]);
    expect(await drain(await streamAnswer(INPUT))).toEqual({ received: "Bonjour", error: null });
    expect(calls[0].url).toBe("http://hermes.test:8642/v1/chat/completions");
  });

  it("accepte une fin sans [DONE] quand le modèle a dit avoir terminé", async () => {
    provider([text("Bonjour"), STOP]);
    expect(await drain(await streamAnswer(INPUT))).toEqual({ received: "Bonjour", error: null });
  });

  it("signale une connexion fermée avant la fin au lieu de rendre une réponse tronquée pour complète", async () => {
    provider([text("La moitié de la ré")]);
    const { received, error } = await drain(await streamAnswer(INPUT));
    expect(received).toBe("La moitié de la ré");
    expect(error).toBeInstanceOf(AiError);
    expect(error?.message).toBe("Hermes a coupé la réponse avant la fin");
  });

  it("exige message_stop d'Anthropic", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "clef-anthropic");
    const delta = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Salut"}}\n\n';
    provider([delta, 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n']);
    expect((await drain(await streamAnswer(INPUT))).error?.message).toMatch(/a coupé la réponse avant la fin/);
    provider([delta, 'event: message_stop\ndata: {"type":"message_stop"}\n\n']);
    expect(await drain(await streamAnswer(INPUT))).toEqual({ received: "Salut", error: null });
  });
});

describe("demande à l'IA : erreurs avant le premier mot", () => {
  it("rejette avec la raison quand le fournisseur échoue dans son flux", async () => {
    provider(['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', 'data: {"error":{"message":"quota dépassé"}}\n\n']);
    await expect(streamAnswer(INPUT)).rejects.toThrow(new AiError("Hermes : quota dépassé"));
  });

  it("rejette avec le refus d'Anthropic", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "clef-anthropic");
    provider(['event: message_start\ndata: {"type":"message_start"}\n\n', 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n']);
    await expect(streamAnswer(INPUT)).rejects.toThrow(/le modèle a refusé de répondre à cette demande/);
    provider(['event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n']);
    await expect(streamAnswer(INPUT)).rejects.toThrow(/Overloaded/);
  });

  it("rejette une réponse vide", async () => {
    provider([STOP, DONE]);
    await expect(streamAnswer(INPUT)).rejects.toThrow("Hermes n'a rien répondu");
  });

  it("livre le texte déjà reçu avant de couper sur une erreur arrivée dans le même morceau", async () => {
    provider([text("Début") + 'data: {"error":"agent arrêté"}\n\n']);
    const { received, error } = await drain(await streamAnswer(INPUT));
    expect(received).toBe("Début");
    expect(error?.message).toBe("Hermes : agent arrêté");
    expect(console.error).toHaveBeenCalledWith("[ia] Hermes : agent arrêté");
  });
});

describe("demande à l'IA : délai", () => {
  it("n'est pas un plafond sur la durée totale : un flux long mais régulier va au bout", async () => {
    vi.useFakeTimers();
    // 20 pieces 100 s apart: over half an hour in all, never more than 150 s of silence.
    const steps: Step[] = [];
    for (let i = 0; i < 20; i++) steps.push(100_000, text(`${i} `));
    const calls = provider([...steps, STOP, DONE]);
    const result = streamAnswer(INPUT).then(drain);
    await vi.advanceTimersByTimeAsync(20 * 100_000);
    expect(await result).toEqual({ received: Array.from({ length: 20 }, (_, i) => `${i} `).join(""), error: null });
    expect(calls[0].signal.aborted).toBe(false);
    // Nothing left behind to abort a finished request or to keep the process busy.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejette quand rien n'arrive avant le délai", async () => {
    vi.useFakeTimers();
    const calls = provider(['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', "hang"]);
    const result = streamAnswer(INPUT).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(149_000);
    expect(calls[0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toEqual(new AiError("Hermes n'a pas répondu à temps"));
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("coupe un flux qui se tait en cours de route", async () => {
    vi.useFakeTimers();
    provider([text("Début"), "hang"]);
    const result = streamAnswer(INPUT).then(drain);
    await vi.advanceTimersByTimeAsync(150_000);
    const { received, error } = await result;
    expect(received).toBe("Début");
    expect(error?.message).toBe("Hermes a cessé de répondre");
  });

  it("ne compte pas le temps où le navigateur ne lit pas", async () => {
    vi.useFakeTimers();
    const calls = provider([text("Un"), text("Deux"), STOP, DONE]);
    const stream = await streamAnswer(INPUT);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls[0].signal.aborted).toBe(false);
    expect(await drain(stream)).toEqual({ received: "UnDeux", error: null });
  });
});

describe("demande à l'IA : secrets dans les erreurs", () => {
  it("refuse une adresse avec identifiants sans la citer ni appeler le réseau", async () => {
    const calls = provider([]);
    vi.stubEnv("HERMES_URL", "http://antoine:s3cret-url@hermes.test:8642");
    const error = await streamAnswer(INPUT).catch((e: Error) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as Error).message).toMatch(/L'adresse de Hermes est invalide/);
    expect((error as Error).message).not.toContain("s3cret-url");
    expect(calls).toHaveLength(0);
  });

  it("retire la clé et les identifiants d'URL de ce que le fournisseur renvoie", async () => {
    provider(["refus de clef-hermes-secrete pour http://u:p4ss@proxy.test/v1"], { status: 401 });
    const error = await streamAnswer(INPUT).catch((e: Error) => e);
    expect((error as Error).message).toBe("Hermes a répondu 401 : refus de … pour http://…@proxy.test/v1");
  });
});
