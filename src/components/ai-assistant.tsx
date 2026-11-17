"use client";

import { AlignLeft, ArrowDownToLine, ChevronLeft, ChevronRight, Copy, Languages, Lock, MessageSquareText, Replace, Sparkles, SpellCheck, Square, TextCursorInput, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { appendInline, fitTo, insertBelow, locate, MAX_AI_INSTRUCTION, MAX_AI_TEXT, replaceRange, type AiAction, type AiLanguage, type AiStatus, type Range } from "@/lib/ai";
import { renderMarkdown } from "@/lib/markdown";
import { api, cn } from "@/lib/utils";
import { Button, inputClass } from "./ui";

/** What the assistant needs from the editor. Getters, because the latest text lives in the editor's draft ref. */
export type AiTarget = {
  getContent: () => string;
  getTitle: () => string;
  isEncrypted: () => boolean;
  area: React.RefObject<HTMLTextAreaElement | null>;
  /** Writes the note through the editor's own change path, so autosave stays correct. */
  apply: (next: string) => void;
};

type Job = {
  id: number;
  action: AiAction;
  label: string;
  /** False when the action ran on the whole note. */
  selection: boolean;
  /** Where the text sent to the AI was in the note, and that text, to find it again when applying. */
  range: Range;
  original: string;
  answer: string;
  state: "streaming" | "done" | "stopped" | "error";
  error?: string;
};

const ACTIONS: { action: AiAction; label: string; Icon: typeof Sparkles; more?: boolean }[] = [
  { action: "summarize", label: "Résumer", Icon: AlignLeft },
  { action: "rewrite", label: "Améliorer la rédaction", Icon: WandSparkles },
  { action: "fix", label: "Corriger l'orthographe", Icon: SpellCheck },
  { action: "continue", label: "Continuer d'écrire", Icon: TextCursorInput },
  { action: "translate", label: "Traduire", Icon: Languages, more: true },
  { action: "custom", label: "Consigne libre", Icon: MessageSquareText, more: true },
];

const LANGUAGES: { code: AiLanguage; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "Anglais" },
  { code: "de", label: "Allemand" },
  { code: "it", label: "Italien" },
  { code: "es", label: "Espagnol" },
];

const ENCRYPTED_REASON = "L'IA est désactivée pour une note chiffrée : l'utiliser enverrait le texte déchiffré au serveur, puis au fournisseur d'IA.";

const UNDO_TOAST = "ai-undo";

export type Ai = ReturnType<typeof useAi>;

/** The assistant's state for one note. `encrypted` follows the note's padlock. */
export function useAi(target: AiTarget, encrypted: boolean) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const abort = useRef<AbortController | null>(null);
  const jobs = useRef(0);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });

  const loadStatus = useCallback(() => {
    api<AiStatus>("/api/ai").then(
      (s) => {
        setStatus(s);
        setStatusError(false);
      },
      // Keep the last known answer: a network failure says nothing about the configuration.
      () => setStatusError(true),
    );
  }, []);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setJob((j) => (j?.state === "streaming" ? { ...j, state: "stopped" } : j));
  }, []);

  const close = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setJob(null);
  }, []);

  // The padlock was closed while an answer was on screen: it was computed from readable text, drop it.
  useEffect(() => {
    if (encrypted) close();
  }, [encrypted, close]);
  // Leaving the note: the request is pointless, and the offer to undo would write through a dead editor.
  useEffect(
    () => () => {
      abort.current?.abort();
      toast.dismiss(UNDO_TOAST);
    },
    [],
  );

  const run = useCallback(async (action: AiAction, label: string, options: { language?: AiLanguage; instruction?: string } = {}) => {
    const t = targetRef.current;
    // Privacy rule, enforced where the request is made and not only in what the menu shows:
    // the readable text of an end-to-end encrypted note never leaves the browser.
    if (t.isEncrypted()) {
      toast.error(ENCRYPTED_REASON);
      return;
    }
    const content = t.getContent();
    const el = t.area.current;
    let range: Range = { start: 0, end: content.length };
    let selection = false;
    if (action === "continue") {
      // Everything before the cursor. A cursor still at the very top means "the whole note".
      const at = el && content.slice(0, el.selectionEnd).trim() ? el.selectionEnd : content.length;
      range = { start: Math.max(0, at - MAX_AI_TEXT), end: at };
    } else if (el && el.selectionEnd > el.selectionStart) {
      range = { start: el.selectionStart, end: el.selectionEnd };
      selection = true;
    }
    const text = content.slice(range.start, range.end);
    if (text.length > MAX_AI_TEXT) {
      toast.error("Ce texte est trop long pour l'IA. Sélectionne un passage plus court.");
      return;
    }
    if (action !== "custom" && !text.trim()) {
      toast.error("Il n'y a pas encore de texte à traiter.");
      return;
    }

    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const base: Job = { id: ++jobs.current, action, label, selection, range, original: text, answer: "", state: "streaming" };
    setJob(base);
    // Only this request may update the panel: a newer one, or Fermer, takes it over.
    const update = (patch: Partial<Job>) => abort.current === controller && setJob({ ...base, ...patch });

    let answer = "";
    let frame = 0;
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, text, title: t.getTitle(), ...options }),
        signal: controller.signal,
      });
      if (res.status === 401) window.location.href = "/login";
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "L'IA n'a pas pu répondre.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read().catch((e) => {
          if (controller.signal.aborted) throw e;
          throw new Error("La réponse s'est interrompue avant la fin.");
        });
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        // At most one render per frame, however fast the text arrives.
        frame ||= requestAnimationFrame(() => {
          frame = 0;
          update({ answer });
        });
      }
      cancelAnimationFrame(frame);
      if (!answer.trim()) throw new Error("L'IA n'a rien répondu.");
      update({ answer, state: "done" });
    } catch (e) {
      cancelAnimationFrame(frame);
      // Stop and Fermer already put the panel in its final state: only hand over the last words received.
      if (controller.signal.aborted) return setJob((j) => (j?.id === base.id ? { ...j, answer } : j));
      const error = (e as Error).message || "L'IA n'a pas pu répondre.";
      update({ answer, state: "error", error });
      toast.error(error, { id: "ai-error" });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }, []);

  /** Writes the result into the note, then closes the panel and gives the caret back to the text. */
  const finish = (next: string, caret: number) => {
    const t = targetRef.current;
    t.apply(next);
    close();
    requestAnimationFrame(() => {
      const el = t.area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const replace = () => {
    if (!job || job.action === "continue") return;
    const current = targetRef.current.getContent();
    if (!job.selection) {
      if (current !== job.original && !window.confirm("La note a changé depuis ta demande. La remplacer quand même par la réponse ?")) return;
      const next = fitTo(current, job.answer);
      finish(next, next.length);
      // Writing the note from code empties the browser's own undo, and autosave follows within a
      // second: without this the previous text, the only copy of it, would be gone for good.
      toast("Note remplacée", {
        id: UNDO_TOAST,
        duration: 15_000,
        action: {
          label: "Annuler",
          onClick: () => {
            const t = targetRef.current;
            // Only put the old text back if nothing was typed since: it would erase the newer edits.
            if (t.getContent() !== next) return void toast.error("La note a changé depuis : l'ancien texte n'a pas été remis.", { description: "Tu peux encore le récupérer en le collant.", action: { label: "Copier l'ancien texte", onClick: () => void navigator.clipboard.writeText(current).catch(() => toast.error("Impossible de copier")) } });
            t.apply(current);
          },
        },
      });
      return;
    }
    const at = locate(current, job.range, job.original);
    if (!at) {
      toast.error("Le passage a changé depuis ta demande.", { description: "Copie la réponse et place-la toi-même." });
      return;
    }
    const answer = fitTo(job.original, job.answer);
    finish(replaceRange(current, at, answer), at.start + answer.length);
  };

  const insert = () => {
    if (!job) return;
    const current = targetRef.current.getContent();
    const at = locate(current, job.range, job.original)?.end ?? current.length;
    const next = job.action === "continue" ? appendInline(current, at, job.answer) : insertBelow(current, at, job.answer);
    // The caret lands right after the inserted text: what followed `at` is unchanged, apart from the
    // line breaks insertBelow normalises.
    const after = current.slice(at);
    finish(next, next.length - (job.action === "continue" ? after : after.replace(/^\n+/, "")).length);
  };

  const copy = async () => {
    if (!job) return;
    try {
      await navigator.clipboard.writeText(job.answer.trim());
      toast.success("Réponse copiée");
    } catch {
      toast.error("Impossible de copier");
    }
  };

  return { status, statusError, loadStatus, job, encrypted, run, stop, close, replace, insert, copy, target: targetRef };
}

type View = "menu" | "translate" | "custom";

/** The "IA" toolbar button and its popover. */
export function AiButton({ ai, disabled }: { ai: Ai; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const id = useId();
  const { status, statusError, loadStatus, encrypted } = ai;
  const ready = !encrypted && !!status?.ready;

  const shut = useCallback((refocus: boolean) => {
    setOpen(false);
    setView("menu");
    if (refocus) button.current?.focus();
  }, []);

  const toggle = () => {
    if (open) return shut(false);
    const el = ai.target.current.area.current;
    const n = el ? el.selectionEnd - el.selectionStart : 0;
    setScope(n > 0 ? `Sur la sélection (${n.toLocaleString("fr-CH")} caractère${n > 1 ? "s" : ""})` : "Sur toute la note");
    // Asked each time the menu opens: cheap, and it follows a change of .env without a reload.
    if (!encrypted) loadStatus();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node)) shut(false);
    };
    document.addEventListener("pointerdown", outside);
    // Tab can carry the focus out of the popover: close it rather than leave it over the editor, out
    // of reach of Escape. focusin, not blur: it only fires when something else really takes the
    // focus, not when the window loses it or when a focused item is replaced by the next view.
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, shut]);

  // Focus follows the popover: its first control, or the popover itself when it only explains something.
  useEffect(() => {
    if (!open) return;
    const first = popover.current?.querySelector<HTMLElement>("input, button");
    (first ?? popover.current)?.focus();
  }, [open, view, ready, statusError]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (view === "menu") shut(true);
      else setView("menu");
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const items = [...(popover.current?.querySelectorAll<HTMLElement>("[data-item]") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  const start = (action: AiAction, label: string, options?: { language?: AiLanguage; instruction?: string }) => {
    shut(false);
    ai.run(action, label, options);
  };

  const item = "press flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-ink outline-none hover:bg-ink/5 focus-visible:bg-ink/5 focus-visible:ring-2 focus-visible:ring-accent/50";
  const back = (
    <button type="button" data-item onClick={() => setView("menu")} className={cn(item, "text-ink-3")}>
      <ChevronLeft className="size-3.5" />
      Retour
    </button>
  );

  return (
    // On a phone the popover spans the toolbar instead of hanging off the button, so it never leaves the screen.
    <div ref={wrap} className="md:relative">
      <Button ref={button} size="sm" variant="ghost" disabled={disabled} onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-label="Demander à l'IA" title="Demander à l'IA" className={cn(open && "bg-ink/5 text-ink")}>
        <Sparkles className="size-3.5" />
        <span className="max-md:hidden">IA</span>
      </Button>
      {open && (
        <div
          ref={popover}
          id={id}
          role="dialog"
          aria-label="Demander à l'IA"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="rise absolute top-full right-0 z-30 mt-1.5 w-[272px] rounded-xl border border-line-strong bg-surface p-1.5 shadow-card outline-none max-md:right-3 max-md:left-3 max-md:mt-1 max-md:w-auto"
        >
          {encrypted ? (
            <p className="flex gap-2.5 p-2.5 text-[12.5px] leading-relaxed text-ink-2">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-accent" />
              <span>{ENCRYPTED_REASON} Retire le cadenas si tu veux t&apos;en servir sur cette note.</span>
            </p>
          ) : !status && statusError ? (
            <p role="alert" className="p-2.5 text-[12.5px] leading-relaxed text-ink-2">
              Impossible de joindre le serveur. Réessaie dans un instant.
            </p>
          ) : !status ? (
            <p className="p-2.5 text-[12.5px] text-ink-3">Un instant…</p>
          ) : !status.ready ? (
            <p className="p-2.5 text-[12.5px] leading-relaxed text-ink-2">
              Aucune IA n&apos;est encore branchée. Ajoute une clé d&apos;API ou Hermes dans{" "}
              <Link href="/settings" className="font-medium text-accent underline-offset-2 hover:underline">
                Réglages
              </Link>
              .
            </p>
          ) : view === "menu" ? (
            <>
              <p className="px-2.5 pt-1.5 pb-1 text-[11.5px] text-ink-3">{scope}</p>
              {ACTIONS.map(({ action, label, Icon, more }) => (
                <button key={action} data-item onClick={() => (more ? setView(action as View) : start(action, label))} className={item}>
                  <Icon className="size-3.5 text-ink-3" />
                  <span className="flex-1">{label}</span>
                  {more && <ChevronRight className="size-3.5 text-ink-3" />}
                </button>
              ))}
              <p className="mt-1 border-t border-line px-2.5 pt-2 pb-1 text-[11.5px] text-ink-3">Avec {status.label}</p>
            </>
          ) : view === "translate" ? (
            <>
              {back}
              <p className="px-2.5 pt-1 pb-1 text-[11.5px] text-ink-3">Traduire en</p>
              {LANGUAGES.map(({ code, label }) => (
                <button key={code} data-item onClick={() => start("translate", `Traduire en ${label.toLowerCase()}`, { language: code })} className={item}>
                  {label}
                </button>
              ))}
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = instruction.trim();
                if (!text) return;
                setInstruction("");
                start("custom", text.length > 60 ? `${text.slice(0, 60)}…` : text, { instruction: text });
              }}
              className="flex flex-col gap-1.5"
            >
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                maxLength={MAX_AI_INSTRUCTION}
                placeholder="Ex. : fais-en une liste de tâches"
                aria-label="Consigne pour l'IA"
                autoComplete="off"
                // 16px on phones: below that, iOS zooms the page when the field takes focus.
                className={cn(inputClass, "h-9 text-[13px] max-md:text-[16px]")}
              />
              <div className="flex items-center gap-1.5">
                <div className="flex-1">{back}</div>
                <Button size="sm" variant="primary" disabled={!instruction.trim()}>
                  Envoyer
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** The answer, docked under the note. It only reaches the note when one of its buttons is pressed. */
export function AiPanel({ ai }: { ai: Ai }) {
  const { job } = ai;
  const panel = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // The answer may have been steered by text pasted into the note: shown without anything that loads
  // from another site on its own. `job.answer` itself stays as written, for Remplacer, Insérer and Copier.
  const html = useMemo(() => (job?.answer ? renderMarkdown(job.answer, { remoteMedia: false }) : ""), [job?.answer]);
  const active = !!job;
  const streaming = job?.state === "streaming";

  // The menu that had the focus is gone: hand it to the panel so the keyboard lands on its buttons.
  useEffect(() => {
    if (active) panel.current?.focus();
  }, [active]);

  // Follow the text while it is being written.
  useEffect(() => {
    if (streaming && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [html, streaming]);

  if (!job) return null;
  const usable = !streaming && !!job.answer.trim();
  const state = streaming ? "L'IA écrit…" : job.state === "done" ? "Terminé" : job.state === "stopped" ? "Arrêté" : "Erreur";

  return (
    <section ref={panel} tabIndex={-1} aria-label="Réponse de l'IA" className="rise flex max-h-[46%] min-h-0 shrink-0 flex-col border-t border-line bg-surface outline-none">
      <header className="flex items-center gap-2 px-5 pt-3 pb-1 max-md:px-4">
        <Sparkles className={cn("size-3.5 shrink-0 text-accent", streaming && "animate-pulse")} />
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
          {job.label}
          <span className="font-normal text-ink-3"> · {job.selection ? "sur la sélection" : job.action === "continue" ? "à la suite du texte" : "sur toute la note"}</span>
        </p>
        <span role="status" className={cn("shrink-0 text-[12px]", job.state === "error" ? "text-danger" : "text-ink-3")}>
          {state}
        </span>
      </header>

      <div ref={body} aria-busy={streaming} className="scroll-thin min-h-[56px] flex-1 overflow-y-auto px-5 py-2 max-md:px-4">
        {html ? <article className="prose-cairn" dangerouslySetInnerHTML={{ __html: html }} /> : streaming ? <p className="text-[13px] text-ink-3">En attente de la réponse…</p> : null}
        {job.error && <p className="mt-2 text-[12.5px] text-danger">{job.error}</p>}
      </div>

      <footer className="flex flex-wrap items-center gap-1.5 border-t border-line px-5 py-2.5 max-md:px-4">
        {streaming ? (
          <Button size="sm" onClick={ai.stop}>
            <Square className="size-3 fill-current" />
            Arrêter
          </Button>
        ) : (
          usable && (
            <>
              {job.action !== "continue" && (
                <Button size="sm" variant="primary" onClick={ai.replace}>
                  <Replace className="size-3.5" />
                  {job.selection ? "Remplacer la sélection" : "Remplacer la note"}
                </Button>
              )}
              <Button size="sm" variant={job.action === "continue" ? "primary" : "secondary"} onClick={ai.insert}>
                <ArrowDownToLine className="size-3.5" />
                {job.action === "continue" ? "Insérer à la suite" : "Insérer en dessous"}
              </Button>
              <Button size="sm" variant="ghost" onClick={ai.copy}>
                <Copy className="size-3.5" />
                Copier
              </Button>
            </>
          )
        )}
        <Button size="sm" variant="ghost" onClick={ai.close} className="ml-auto">
          <X className="size-3.5" />
          Fermer
        </Button>
      </footer>
    </section>
  );
}
