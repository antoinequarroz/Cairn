import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cairn-chat-"));
});

import { ChatError, sendChatMessage, stopChat } from "./chat";
import { createConversation, createFolder, createNote, getConversation, listMessages, updateNote } from "./db";

const text = (s: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;
const END = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

type Step = string | number | "hang";

/** A fake Hermes: answers 200 with the given SSE pieces. A number waits, "hang" never sends more. Records each request body. */
function provider(steps: Step[]) {
  const bodies: { model: string; messages: { role: string; content: string }[] }[] = [];
  vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => {
    const signal = options.signal!;
    bodies.push(JSON.parse(options.body as string));
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
    return new Response(body, { status: 200 });
  });
  return bodies;
}

const settle = async (conversationId: string) => {
  for (let i = 0; i < 100 && listMessages(conversationId).some((m) => m.state === "streaming"); i++) await new Promise((r) => setTimeout(r, 10));
  return listMessages(conversationId);
};

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "");
  vi.stubEnv("HERMES_URL", "http://hermes.test:8642");
  vi.stubEnv("HERMES_API_KEY", "clef-hermes");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("discussion : enregistrement de la réponse", () => {
  it("enregistre la question, la réponse, et donne un titre à la discussion", async () => {
    provider([text("Bon"), text("jour"), END]);
    const c = createConversation({});
    const turn = await sendChatMessage(c.id, "Dis bonjour\navec une deuxième ligne");
    expect(await new Response(turn.stream).text()).toBe("Bonjour");
    const messages = await settle(c.id);
    expect(messages.map((m) => [m.role, m.content, m.state])).toEqual([
      ["user", "Dis bonjour\navec une deuxième ligne", "done"],
      ["assistant", "Bonjour", "done"],
    ]);
    expect(messages[1].model).toBe("Hermes");
    expect(getConversation(c.id)?.title).toBe("Dis bonjour");
  });

  it("va jusqu'au bout et enregistre tout même si le navigateur part en cours de route", async () => {
    provider([text("Début "), 20, text("suite "), 20, text("fin"), END]);
    const c = createConversation({});
    const turn = await sendChatMessage(c.id, "Question");
    const reader = turn.stream.getReader();
    await reader.read();
    await reader.cancel();
    const messages = await settle(c.id);
    expect(messages[1]).toMatchObject({ content: "Début suite fin", state: "done" });
  });

  it("Arrêter garde ce qui est déjà écrit", async () => {
    provider([text("Le début"), "hang"]);
    const c = createConversation({});
    const turn = await sendChatMessage(c.id, "Question");
    const reader = turn.stream.getReader();
    await reader.read();
    expect(stopChat(c.id)).toBe(true);
    const messages = await settle(c.id);
    expect(messages[1]).toMatchObject({ content: "Le début", state: "stopped" });
    expect(stopChat(c.id)).toBe(false);
  });

  it("enregistre l'erreur quand le fournisseur échoue avant le premier mot", async () => {
    provider(['data: {"error":{"message":"quota dépassé"}}\n\n']);
    const c = createConversation({});
    await expect(sendChatMessage(c.id, "Question")).rejects.toThrow(new ChatError("Hermes : quota dépassé", 502));
    expect(listMessages(c.id)[1]).toMatchObject({ role: "assistant", state: "error", error: "Hermes : quota dépassé" });
  });

  it("refuse un deuxième message pendant qu'une réponse s'écrit", async () => {
    provider([text("Lent"), "hang"]);
    const c = createConversation({});
    await sendChatMessage(c.id, "Première");
    await expect(sendChatMessage(c.id, "Deuxième")).rejects.toMatchObject({ status: 409 });
    stopChat(c.id);
    await settle(c.id);
    expect(listMessages(c.id).filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("refuse sans IA configurée, sans rien enregistrer", async () => {
    vi.stubEnv("HERMES_URL", "");
    const c = createConversation({});
    await expect(sendChatMessage(c.id, "Question")).rejects.toMatchObject({ status: 503 });
    expect(listMessages(c.id)).toEqual([]);
  });
});

describe("discussion : contexte", () => {
  it("envoie l'historique, les consignes du dossier et les notes épinglées, jamais une note chiffrée", async () => {
    const projet = createFolder({ name: "VPS", instructions: "Réponds avec les commandes." });
    const lisible = createNote({ title: "Config Caddy", content: "reverse_proxy 172.17.0.1:3020", folderId: projet.id });
    const secrete = createNote({ title: "Clés", content: "x" });
    updateNote(secrete.id, { content: "bloc-chiffre-illisible", encrypted: true });
    const c = createConversation({ folderId: projet.id, contextNoteIds: [lisible.id, secrete.id, "note-supprimee"] });

    let bodies = provider([text("Première réponse"), END]);
    await new Response((await sendChatMessage(c.id, "Premier message")).stream).text();
    await settle(c.id);
    bodies = provider([text("Deuxième réponse"), END]);
    const turn = await sendChatMessage(c.id, "Deuxième message");
    expect(turn.skippedNotes).toEqual(["Clés"]);
    await new Response(turn.stream).text();

    const [system, ...rest] = bodies[0].messages;
    expect(system.role).toBe("system");
    expect(system.content).toContain("Réponds avec les commandes.");
    expect(system.content).toContain("reverse_proxy 172.17.0.1:3020");
    expect(JSON.stringify(bodies[0])).not.toContain("bloc-chiffre-illisible");
    // The same identifier from one message to the next: the prompt starts the same way, the provider's cache can serve it.
    const first = bodies[0].messages[0].content;
    const again = provider([text("Troisième réponse"), END]);
    await new Response((await sendChatMessage(c.id, "Troisième message")).stream).text();
    expect(again[0].messages[0].content).toBe(first);
    expect(rest).toEqual([
      { role: "user", content: "Premier message" },
      { role: "assistant", content: "Première réponse" },
      { role: "user", content: "Deuxième message" },
    ]);
  });
});

describe("discussion : mode « Mes notes »", () => {
  it("cherche dans les notes à chaque message, envoie celles trouvées, jamais une note chiffrée, et garde les sources", async () => {
    const lisible = createNote({ title: "Sauvegardes", content: "Les sauvegardes partent à 3h vers Swiss Backup." });
    const secrete = createNote({ title: "Sauvegardes : clé age", content: "x" });
    updateNote(secrete.id, { content: "bloc-chiffre-sauvegardes", encrypted: true });
    const c = createConversation({ notesSearch: { folderId: null } });

    const bodies = provider([text(`À 3h, voir [Sauvegardes](/notes/${lisible.id}).`), END]);
    const turn = await sendChatMessage(c.id, "Qu'est-ce que j'ai noté sur les sauvegardes ?");
    expect(turn.sources).toEqual([{ id: lisible.id, title: "Sauvegardes" }]);
    await new Response(turn.stream).text();
    const messages = await settle(c.id);
    expect(messages[1].sources).toEqual([{ id: lisible.id, title: "Sauvegardes" }]);

    const sent = JSON.stringify(bodies[0]);
    expect(sent).toContain("Swiss Backup");
    expect(sent).not.toContain("bloc-chiffre-sauvegardes");
    expect(sent).not.toContain(secrete.id);
    expect(bodies[0].messages[0].content).toContain('"My notes" mode is on');
  });

  it("sans le mode, ne cherche rien", async () => {
    createNote({ title: "Mot de passe Wi-Fi", content: "invites-2026" });
    const c = createConversation({});
    const bodies = provider([text("Ok"), END]);
    const turn = await sendChatMessage(c.id, "Quel est le mot de passe Wi-Fi ?");
    expect(turn.sources).toBeNull();
    await new Response(turn.stream).text();
    expect(JSON.stringify(bodies[0])).not.toContain("invites-2026");
    expect((await settle(c.id))[1].sources).toBeUndefined();
  });
});
