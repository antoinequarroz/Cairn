import "server-only";
import { buildChatPrompt, titleFrom, type ChatNote } from "@/lib/chat";
import { AiError, aiStatus, streamCompletion } from "./ai";
import { addMessage, db, folderChain, getConversation, getNote, listMessages, updateConversation, updateMessage } from "./db";

/** An error whose message is safe to show, in French, with the HTTP status to send it with. */
export class ChatError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Answers being written, by discussion. In memory: Cairn is one process, and an answer that was
// running when it stopped is marked as stopped on the next start (src/server/db.ts).
const globalForChat = globalThis as unknown as { __cairnChats?: Map<string, AbortController> };
const running = (globalForChat.__cairnChats ??= new Map());

/** How often a streaming answer is written to the database: often enough to lose little on a crash. */
const SAVE_EVERY_MS = 1_000;

export type ChatTurnResult = {
  stream: ReadableStream<Uint8Array>;
  userMessageId: string;
  assistantMessageId: string;
  /** Titles of the pinned notes the AI could not read: locked, deleted, or too long to fit. */
  skippedNotes: string[];
};

/**
 * Sends one message in a discussion and streams the answer.
 *
 * The answer belongs to the server, not to the browser that asked: it is read to its end and saved
 * as it comes, even if the tab is closed. The returned stream is only a live copy of it. Only
 * stopChat() stops it.
 */
export async function sendChatMessage(conversationId: string, content: string): Promise<ChatTurnResult> {
  const conversation = getConversation(conversationId);
  if (!conversation) throw new ChatError("Discussion introuvable", 404);
  const status = aiStatus();
  if (!status.ready) throw new ChatError("Aucune IA n'est configurée sur ce serveur. Voir Réglages > IA.", 503);

  // Checked and written with no await in between: two tabs cannot both start an answer.
  if (running.has(conversationId) || listMessages(conversationId).some((m) => m.state === "streaming")) throw new ChatError("Une réponse est déjà en cours dans cette discussion", 409);
  const { user, assistant } = db().transaction(() => {
    const user = addMessage(conversationId, { role: "user", content });
    if (!conversation.title.trim()) updateConversation(conversationId, { title: titleFrom(content) });
    const assistant = addMessage(conversationId, { role: "assistant", content: "", state: "streaming", model: status.label });
    return { user, assistant };
  })();
  const abort = new AbortController();
  running.set(conversationId, abort);

  // The notes are read here, on the server. A locked note is a ciphertext the server cannot read:
  // it is left out, and its readable text never exists here to be sent anywhere.
  const skippedNotes: string[] = [];
  const notes: ChatNote[] = [];
  for (const id of conversation.contextNoteIds) {
    const note = getNote(id);
    if (!note) continue;
    if (note.encrypted) skippedNotes.push(note.title || "Sans titre");
    else notes.push({ id: note.id, title: note.title, content: note.content });
  }
  const prompt = buildChatPrompt({ folders: folderChain(conversation.folderId), notes, history: listMessages(conversationId) });
  skippedNotes.push(...prompt.omittedNotes.map((n) => n.title || "Sans titre"));

  let upstream: ReadableStream<Uint8Array>;
  try {
    upstream = await streamCompletion(prompt, abort.signal, { cache: true, sessionKey: `cairn-chat-${conversationId}` });
  } catch (e) {
    running.delete(conversationId);
    if (abort.signal.aborted) {
      updateMessage(assistant.id, { state: "stopped" });
      throw new ChatError("Réponse arrêtée", 499);
    }
    const message = e instanceof AiError ? e.message : "L'IA n'a pas pu répondre";
    updateMessage(assistant.id, { state: "error", error: message });
    if (!(e instanceof AiError)) console.error("[chat]", e);
    throw new ChatError(message, 502);
  }

  // The live copy for the browser. If the browser goes away, the answer carries on without it.
  let live: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      live = c;
    },
    cancel() {
      live = null;
    },
  });
  const toBrowser = (fn: (c: ReadableStreamDefaultController<Uint8Array>) => void) => {
    if (!live) return;
    try {
      fn(live);
    } catch {
      live = null;
    }
  };

  void (async () => {
    const reader = upstream.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let savedAt = Date.now();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        toBrowser((c) => c.enqueue(value));
        if (Date.now() - savedAt >= SAVE_EVERY_MS) {
          updateMessage(assistant.id, { content: text });
          savedAt = Date.now();
        }
      }
      text += decoder.decode();
      updateMessage(assistant.id, { content: text, state: "done" });
      toBrowser((c) => c.close());
    } catch (e) {
      text += decoder.decode();
      if (abort.signal.aborted) {
        updateMessage(assistant.id, { content: text, state: "stopped" });
        toBrowser((c) => c.close());
      } else {
        const message = e instanceof AiError ? e.message : "La réponse a été coupée";
        updateMessage(assistant.id, { content: text, state: "error", error: message });
        toBrowser((c) => c.error(e));
      }
    } finally {
      running.delete(conversationId);
    }
  })();

  return { stream, userMessageId: user.id, assistantMessageId: assistant.id, skippedNotes };
}

/** Stops the answer being written in a discussion. What it already wrote is kept. */
export function stopChat(conversationId: string) {
  const abort = running.get(conversationId);
  if (!abort) return false;
  abort.abort();
  return true;
}

/** True while an answer is being written: the discussion must not be deleted under it. */
export const chatRunning = (conversationId: string) => running.has(conversationId);
