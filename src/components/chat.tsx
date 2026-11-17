"use client";

import { ArrowUp, Check, Copy, FilePlus2, FileText, Lock, Paperclip, Square, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { AiStatus } from "@/lib/ai";
import { MAX_CHAT_MESSAGE, MAX_CONTEXT_NOTES } from "@/lib/chat";
import { renderMarkdown } from "@/lib/markdown";
import { folderPath, useNotes } from "@/lib/notes-store";
import type { ChatMessage, Conversation, Note } from "@/lib/types";
import { api, ApiError, cn } from "@/lib/utils";
import { FolderSelect } from "./folder-select";
import { Button, inputClass } from "./ui";
import { Prose } from "./prose";

/** How often a discussion whose answer is being written elsewhere (another tab, a closed one) is read again. */
const POLL_MS = 1_500;

export function Chat({ id }: { id: string }) {
  const router = useRouter();
  const { notes, folders, touchConversation, removeConversation, touch } = useNotes();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The pinned notes as last chosen, ahead of the server's answer: two quick picks must both stay.
  const pinnedIds = useRef<string[] | null>(null);
  const pinSaving = useRef<Promise<void>>(Promise.resolve());

  /** Reads the discussion again. Only a 404 means it is gone: a network hiccup keeps what is on screen. */
  const fetchConversation = useCallback(async () => {
    try {
      const data = await api<{ conversation: Conversation; messages: ChatMessage[] }>(`/api/conversations/${id}`);
      setMissing(false);
      return data;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      return null;
    }
  }, [id]);

  const load = useCallback(async () => {
    const data = await fetchConversation();
    if (data) {
      setConversation(data.conversation);
      setMessages(data.messages);
    }
    return data;
  }, [fetchConversation]);

  useEffect(() => {
    load().then((data) => {
      if (data) setTitle(data.conversation.title);
    });
    api<AiStatus>("/api/ai").then(setStatus, () => {});
    input.current?.focus();
    // Leaving the discussion: the answer carries on on the server, only this copy of it stops.
    return () => abort.current?.abort();
  }, [load]);

  // An answer written by the server while this page is not the one reading it: follow it.
  const writingElsewhere = !sending && messages.some((m) => m.state === "streaming");
  useEffect(() => {
    if (!writingElsewhere) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [writingElsewhere, load]);

  // Follow the answer as it grows, unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const saveConversation = useCallback(
    async (patch: { title?: string; folderId?: string | null; contextNoteIds?: string[] }) => {
      try {
        const { conversation: c } = await api<{ conversation: Conversation }>(`/api/conversations/${id}`, { method: "PATCH", json: patch });
        setConversation(c);
        touchConversation(c);
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [id, touchConversation],
  );

  const send = async () => {
    const content = draft.trim();
    if (!content || sending || writingElsewhere) return;
    if (content.length > MAX_CHAT_MESSAGE) {
      toast.error(`Message trop long (${MAX_CHAT_MESSAGE.toLocaleString("fr-CH")} caractères au plus). Mets le texte dans une note et épingle-la.`);
      return;
    }
    setSending(true);
    setDraft("");
    stick.current = true;
    const now = new Date().toISOString();
    const pending: ChatMessage = { id: "pending-answer", role: "assistant", content: "", state: "streaming", model: status?.label, createdAt: now };
    setMessages((m) => [...m, { id: "pending-question", role: "user", content, state: "done", createdAt: now }, pending]);

    const controller = new AbortController();
    abort.current = controller;
    // Refused before anything was saved (too long, no AI, an answer already running): the text goes back in the box.
    let refused = false;
    let answerId = pending.id;
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }), signal: controller.signal });
      if (res.status === 401) window.location.href = "/login";
      if (!res.ok || !res.body) {
        // Only these mean nothing was saved. On a 502 the message was saved and the AI failed (the
        // discussion shows why); on a 499 it was saved and stopped before the first word.
        refused = [400, 404, 409, 503].includes(res.status);
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 499) return;
        throw new Error(data.error ?? "L'IA n'a pas pu répondre");
      }
      // From now on the answer has its id on the server: a reload of the discussion keeps following it.
      const saved = res.headers.get("X-Cairn-Message-Id");
      if (saved) {
        setMessages((m) => m.map((x) => (x.id === pending.id ? { ...x, id: saved } : x)));
        answerId = saved;
      }
      const skipped = parseSkipped(res.headers.get("X-Cairn-Skipped-Notes"));
      if (skipped.length)
        toast(`${skipped.length > 1 ? `${skipped.length} notes épinglées n'ont pas été lues` : "Une note épinglée n'a pas été lue"} par l'IA`, {
          description: `${skipped.join(", ")}. Une note chiffrée n'est jamais envoyée, et une note trop longue ne tient pas dans la discussion.`,
        });
      // The discussion now has its title, from this first message. Only the title: the messages on
      // screen are the live ones.
      if (!conversation?.title)
        fetchConversation().then((d) => {
          if (!d) return;
          setConversation(d.conversation);
          setTitle(d.conversation.title);
          touchConversation(d.conversation);
        });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        const shown = text;
        setMessages((m) => m.map((x) => (x.id === answerId ? { ...x, content: shown } : x)));
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      if (!(e instanceof TypeError)) toast.error((e as Error).message);
    } finally {
      if (abort.current === controller) abort.current = null;
      if (!controller.signal.aborted) {
        // The server's copy is the reference: final text, state, and the reason of a failure.
        const data = await load();
        if (data) touchConversation(data.conversation);
        if (refused) setDraft((d) => d || content);
        setSending(false);
      }
    }
  };

  const stop = async () => {
    try {
      await api(`/api/conversations/${id}/stop`, { method: "POST" });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const del = async () => {
    if (!window.confirm("Supprimer cette discussion ? C'est définitif.")) return;
    try {
      // The server stops the answer itself. The live copy is dropped only once the delete went through.
      await api(`/api/conversations/${id}`, { method: "DELETE" });
      abort.current?.abort();
      removeConversation(id);
      router.push(conversation?.folderId ? `/folders/${conversation.folderId}` : "/chat");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveAsNote = async (m: ChatMessage) => {
    try {
      const { note } = await api<{ note: Note }>("/api/notes", { method: "POST", json: { title: conversation?.title || "Réponse de l'IA", content: m.content, folderId: conversation?.folderId ?? null } });
      touch(note);
      toast("Réponse enregistrée comme note", { action: { label: "Ouvrir", onClick: () => router.push(`/notes/${note.id}`) } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const savePinned = (next: string[]) => {
    pinnedIds.current = next;
    setConversation((c) => (c ? { ...c, contextNoteIds: next } : c));
    // One save at a time, each sending the latest choice: an older answer never lands last.
    pinSaving.current = pinSaving.current.then(async () => {
      const ids = pinnedIds.current;
      if (!ids) return;
      try {
        const { conversation: c } = await api<{ conversation: Conversation }>(`/api/conversations/${id}`, { method: "PATCH", json: { contextNoteIds: ids } });
        touchConversation(c);
        if (pinnedIds.current === ids) {
          pinnedIds.current = null;
          setConversation(c);
        }
      } catch (e) {
        toast.error((e as Error).message);
        pinnedIds.current = null;
        load();
      }
    });
  };

  const pinned = useMemo(() => (conversation?.contextNoteIds ?? []).map((nid) => notes.find((n) => n.id === nid)).filter((n) => !!n), [conversation, notes]);

  if (missing)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-[15px] font-medium">Cette discussion n&apos;existe plus</p>
        <Link href="/chat" className="text-[13px] text-accent">
          Revenir aux discussions
        </Link>
      </div>
    );
  if (!conversation) return <div className="flex-1" />;

  const busy = sending || writingElsewhere;
  const path = folderPath(folders, conversation.folderId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex items-center gap-1.5 border-b border-line px-5 py-2.5 max-md:px-3">
        <FolderSelect value={conversation.folderId} onChange={(folderId) => saveConversation({ folderId })} className="max-w-[220px]" />
        <Button ref={triggerRef} size="sm" variant="ghost" onClick={() => setContextOpen((o) => !o)} aria-expanded={contextOpen} title="Notes que l'IA lit avec chaque message" className={cn(pinned.length > 0 && "text-accent")}>
          <Paperclip className="size-3.5" />
          <span className="max-md:hidden">{pinned.length ? `${pinned.length} note${pinned.length > 1 ? "s" : ""} en contexte` : "Ajouter des notes"}</span>
          {pinned.length > 0 && <span className="md:hidden">{pinned.length}</span>}
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          {status && <span className="truncate text-[12px] text-ink-3 max-md:hidden">{status.ready ? status.label : "Aucune IA configurée"}</span>}
          <Button size="sm" variant="ghost" onClick={del} aria-label="Supprimer la discussion" title="Supprimer">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        {contextOpen && <ContextPicker conversation={conversation} trigger={triggerRef} onChange={savePinned} onClose={() => setContextOpen(false)} />}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== conversation.title && saveConversation({ title })}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="Nouvelle discussion"
        aria-label="Titre de la discussion"
        className="w-full bg-transparent px-7 pt-5 pb-1 font-display text-[28px] leading-tight outline-none placeholder:text-ink-3 max-md:px-4 max-md:text-[24px]"
      />
      {(path || pinned.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 px-7 pb-2 text-[12px] text-ink-3 max-md:px-4">
          {path && <span>{path}</span>}
          {pinned.map((n) => (
            <Link key={n.id} href={`/notes/${n.id}`} className={cn("flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 hover:text-ink", n.encrypted && "line-through")} title={n.encrypted ? "Chiffrée : jamais envoyée à l'IA" : undefined}>
              {n.encrypted ? <Lock className="size-3" /> : <FileText className="size-3" />}
              {n.title || "Sans titre"}
            </Link>
          ))}
        </div>
      )}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto px-7 py-4 max-md:px-4"
      >
        <div className="mx-auto flex max-w-[760px] flex-col gap-5">
          {!messages.length && (
            <div className="py-10 text-center">
              <p className="font-display text-[22px] leading-none">Pose ta question</p>
              <p className="mx-auto mt-2 max-w-[420px] text-[13px] text-ink-3">
                L&apos;IA lit les consignes du projet et les notes épinglées. La discussion est enregistrée dans {path ? <b className="font-medium text-ink-2">{path}</b> : "tes notes"}, même si tu fermes l&apos;onglet pendant la réponse.
              </p>
            </div>
          )}
          {messages.map((m) => (m.role === "user" ? <UserMessage key={m.id} message={m} /> : <AssistantMessage key={m.id} message={m} onSave={() => saveAsNote(m)} />))}
        </div>
      </div>

      <div className="border-t border-line px-7 py-3 max-md:px-3">
        <div className="mx-auto flex max-w-[760px] items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 shadow-card focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={Math.min(8, Math.max(1, draft.split("\n").length))}
            placeholder={status && !status.ready ? "Configure une IA dans Réglages > IA pour discuter" : "Écris un message…"}
            aria-label="Message"
            className="scroll-thin max-h-[200px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] leading-relaxed outline-none placeholder:text-ink-3"
          />
          {busy ? (
            <Button variant="secondary" onClick={stop} aria-label="Arrêter la réponse" title="Arrêter">
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button variant="primary" onClick={send} disabled={!draft.trim() || (status !== null && !status.ready)} aria-label="Envoyer" title="Envoyer (Entrée)">
              <ArrowUp className="size-4" strokeWidth={2.4} />
            </Button>
          )}
        </div>
        {status && !status.ready && (
          <p className="mx-auto mt-1.5 max-w-[760px] text-[12px] text-ink-3">
            Aucune IA n&apos;est configurée.{" "}
            <Link href="/settings" className="text-accent">
              Ouvrir Réglages &gt; IA
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

function parseSkipped(header: string | null): string[] {
  if (!header) return [];
  try {
    const v: unknown = JSON.parse(decodeURIComponent(header));
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap">{message.content}</div>
  );
}

function AssistantMessage({ message, onSave }: { message: ChatMessage; onSave: () => void }) {
  const [copied, setCopied] = useState(false);
  // An answer is text the user did not write, possibly steered by a pinned note: nothing in it loads from another site by itself.
  const html = useMemo(() => (message.content ? renderMarkdown(message.content, { remoteMedia: false }) : ""), [message.content]);
  const streaming = message.state === "streaming";
  return (
    <div className="group flex flex-col gap-1.5">
      {html ? <Prose html={html} /> : streaming && <p className="animate-pulse text-[13.5px] text-ink-3">L&apos;IA réfléchit…</p>}
      {message.state === "error" && <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">{message.error ?? "La réponse a échoué"}</p>}
      {message.state === "stopped" && <p className="text-[12px] text-ink-3">Réponse arrêtée</p>}
      {!streaming && message.content && (
        <div className="flex items-center gap-1 text-[12px] text-ink-3 opacity-70 transition-opacity group-hover:opacity-100">
          {message.model && <span className="mr-1">{message.model}</span>}
          <button
            onClick={() => {
              navigator.clipboard.writeText(message.content).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-ink/5 hover:text-ink"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            Copier
          </button>
          <button onClick={onSave} className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-ink/5 hover:text-ink">
            <FilePlus2 className="size-3.5" />
            Enregistrer comme note
          </button>
        </div>
      )}
    </div>
  );
}

/** Which notes the AI reads with each message. Notes of the discussion's folder come first. */
function ContextPicker({ conversation, trigger, onChange, onClose }: { conversation: Conversation; trigger: React.RefObject<HTMLButtonElement | null>; onChange: (ids: string[]) => void; onClose: () => void }) {
  const { notes, folders } = useNotes();
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      // A click on the button that opened it is left to the button, which toggles.
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [onClose, trigger]);

  const selected = new Set(conversation.contextNoteIds);
  const q = query.trim().toLowerCase();
  const list = notes
    .filter((n) => !q || `${n.title} ${n.excerpt}`.toLowerCase().includes(q))
    .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || Number(b.folderId === conversation.folderId) - Number(a.folderId === conversation.folderId))
    .slice(0, 60);

  const toggle = (id: string) => {
    const next = selected.has(id) ? conversation.contextNoteIds.filter((x) => x !== id) : [...conversation.contextNoteIds, id];
    if (next.length > MAX_CONTEXT_NOTES) {
      toast.error(`${MAX_CONTEXT_NOTES} notes au plus par discussion`);
      return;
    }
    onChange(next);
  };

  return (
    <div ref={ref} className="absolute top-full left-3 z-30 mt-1 flex w-[min(380px,calc(100vw-24px))] flex-col rounded-2xl border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]">
      <div className="flex items-center gap-2 border-b border-line p-2">
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher une note…" className={cn(inputClass, "h-8 text-[13px]")} />
        <button onClick={onClose} aria-label="Fermer" className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <div className="scroll-thin max-h-[320px] overflow-y-auto p-1">
        {list.map((n) => (
          <label key={n.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink/[0.04]", n.encrypted && "cursor-not-allowed opacity-60")}>
            <input type="checkbox" checked={selected.has(n.id)} disabled={n.encrypted && !selected.has(n.id)} onChange={() => toggle(n.id)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{n.title || "Sans titre"}</span>
              <span className="block truncate text-[11.5px] text-ink-3">{n.encrypted ? "Chiffrée : jamais envoyée à l'IA" : folderPath(folders, n.folderId) || "Sans dossier"}</span>
            </span>
            {n.encrypted && <Lock className="size-3.5 shrink-0 text-accent" />}
          </label>
        ))}
        {!list.length && <p className="px-2 py-6 text-center text-[13px] text-ink-3">Aucune note.</p>}
      </div>
      <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-3">L&apos;IA lit ces notes avec chaque message, en plus des consignes du projet.</p>
    </div>
  );
}
