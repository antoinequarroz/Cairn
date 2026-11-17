"use client";

import {
  Bold,
  CalendarDays,
  ChevronsDownUp,
  CircleHelp,
  Clock,
  FileText,
  Lightbulb,
  SpellCheck,
  SquareTerminal,
  TextCursorInput,
  TriangleAlert,
  WandSparkles,
  AlignLeft,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Quote,
  SquareCode,
  Strikethrough,
  Table,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AiAction } from "@/lib/ai";
import {
  activeFormats,
  callout,
  codeBlock,
  continueList,
  divider,
  fencedCode,
  imageByUrl,
  indentList,
  insertText,
  link,
  noteLink,
  setBlock,
  table,
  toggleBlock,
  toggleInline,
  type BlockFormat,
  type Edit,
  type InlineFormat,
} from "@/lib/md-format";
import type { NoteSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Kbd } from "./ui";

type Area = React.RefObject<HTMLTextAreaElement | null>;
type Run = (text: string, start: number, end: number) => Edit;

/**
 * Writes an edit into the textarea the way typing would: through the browser's own editing, so
 * Cmd+Z undoes it and React's onChange (hence autosave) sees it.
 */
export function applyEdit(el: HTMLTextAreaElement, e: Edit) {
  el.focus();
  el.setSelectionRange(e.from, e.to);
  if (e.from !== e.to || e.insert) {
    const ok = e.insert ? document.execCommand("insertText", false, e.insert) : document.execCommand("delete");
    if (!ok || el.value.slice(e.from, e.from + e.insert.length) !== e.insert) {
      el.setRangeText(e.insert, e.from, e.to, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  el.setSelectionRange(e.selStart, e.selEnd);
}

/** What a command does besides writing text: open the file picker, pick a note, or ask the AI. */
type Special = "upload" | "note-link" | `ai:${AiAction}`;

/** Every block that can be inserted: the toolbar, the shortcuts and the "/" menu share them. */
export type Command = {
  id: string;
  label: string;
  hint: string;
  Icon: typeof Bold;
  keywords: string;
  /** The heading it is listed under in the "/" menu. */
  section: string;
  run: Run | Special;
};

const block =
  (f: BlockFormat): Run =>
  (t, s, e) =>
    setBlock(t, s, e, f);
const inline =
  (f: InlineFormat): Run =>
  (t, s, e) =>
    toggleInline(t, s, e, f);

const today = () => {
  const d = new Date();
  return `${d.toLocaleDateString("fr-CH", { weekday: "long" })} ${d.toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric" })}`;
};
const now = () => new Date().toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });

export const BLOCKS: Command[] = [
  { id: "paragraph", section: "Texte", label: "Texte", hint: "Un paragraphe normal", Icon: Pilcrow, keywords: "texte paragraphe normal text", run: block("paragraph") },
  { id: "h1", section: "Texte", label: "Titre 1", hint: "Grand titre de section", Icon: Heading1, keywords: "titre h1 heading grand", run: block("h1") },
  { id: "h2", section: "Texte", label: "Titre 2", hint: "Titre moyen", Icon: Heading2, keywords: "titre h2 heading sous-titre", run: block("h2") },
  { id: "h3", section: "Texte", label: "Titre 3", hint: "Petit titre", Icon: Heading3, keywords: "titre h3 heading", run: block("h3") },
  { id: "quote", section: "Texte", label: "Citation", hint: "Un passage mis en retrait", Icon: Quote, keywords: "citation quote retrait", run: block("quote") },
  { id: "bullet", section: "Listes", label: "Liste à puces", hint: "Une liste simple", Icon: List, keywords: "liste puces bullet ul", run: block("bullet") },
  { id: "numbered", section: "Listes", label: "Liste numérotée", hint: "1, 2, 3…", Icon: ListOrdered, keywords: "liste numerotee ordonnee ol nombre etapes", run: block("numbered") },
  { id: "task", section: "Listes", label: "Liste de tâches", hint: "Des cases à cocher", Icon: ListTodo, keywords: "taches todo checklist case cocher", run: block("task") },
  {
    id: "info",
    section: "Blocs",
    label: "Encadré « À savoir »",
    hint: "Mettre une info en avant",
    Icon: Lightbulb,
    keywords: "encadre callout info astuce note savoir important",
    run: (t, s, e) => callout(t, s, e, "💡", "À savoir"),
  },
  {
    id: "warning",
    section: "Blocs",
    label: "Encadré « Attention »",
    hint: "Un avertissement",
    Icon: TriangleAlert,
    keywords: "encadre callout attention avertissement warning danger",
    run: (t, s, e) => callout(t, s, e, "⚠️", "Attention"),
  },
  {
    id: "toggle",
    section: "Blocs",
    label: "Bloc repliable",
    hint: "Du contenu qui s'ouvre d'un clic",
    Icon: ChevronsDownUp,
    keywords: "repliable toggle depliant details cacher accordeon",
    run: toggleBlock,
  },
  { id: "code", section: "Blocs", label: "Bloc de code", hint: "Du code sur plusieurs lignes", Icon: SquareCode, keywords: "code bloc programme script", run: codeBlock },
  {
    id: "terminal",
    section: "Blocs",
    label: "Commandes terminal",
    hint: "Bash, SSH, commandes du VPS",
    Icon: SquareTerminal,
    keywords: "terminal bash shell ssh commande vps serveur console",
    run: (t, s, e) => fencedCode(t, s, e, "bash"),
  },
  { id: "table", section: "Blocs", label: "Tableau", hint: "Trois colonnes à remplir", Icon: Table, keywords: "tableau table colonnes grille", run: table },
  { id: "divider", section: "Blocs", label: "Séparateur", hint: "Une ligne horizontale", Icon: Minus, keywords: "separateur ligne divider hr", run: divider },
  {
    id: "upload",
    section: "Médias et liens",
    label: "Image, vidéo ou fichier",
    hint: "Depuis ton appareil",
    Icon: ImagePlus,
    keywords: "image photo video fichier joindre upload media pdf audio",
    run: "upload",
  },
  { id: "image-url", section: "Médias et liens", label: "Image par lien", hint: "Une image déjà en ligne", Icon: ImageIcon, keywords: "image lien url web", run: imageByUrl },
  { id: "link", section: "Médias et liens", label: "Lien", hint: "Vers une page web", Icon: LinkIcon, keywords: "lien link url web", run: link },
  { id: "note-link", section: "Médias et liens", label: "Lien vers une note", hint: "Une autre note de Cairn", Icon: FileText, keywords: "note lien interne page mention reference", run: "note-link" },
  {
    id: "date",
    section: "Insérer",
    label: "Date du jour",
    hint: "Par exemple « mardi 17 novembre 2026 »",
    Icon: CalendarDays,
    keywords: "date jour aujourd'hui today",
    run: (_t, s, e) => insertText(s, e, today()),
  },
  { id: "time", section: "Insérer", label: "Heure", hint: "L'heure qu'il est", Icon: Clock, keywords: "heure maintenant time now", run: (_t, s, e) => insertText(s, e, now()) },
];

/** Only offered when the note can go to the AI (not end-to-end encrypted). */
export const AI_COMMANDS: Command[] = [
  { id: "ai-continue", section: "IA", label: "Continuer avec l'IA", hint: "La suite de ce qui est écrit", Icon: TextCursorInput, keywords: "ia ai continuer suite ecrire claude", run: "ai:continue" },
  { id: "ai-summarize", section: "IA", label: "Résumer la note", hint: "Les points clés", Icon: AlignLeft, keywords: "ia ai resumer resume synthese", run: "ai:summarize" },
  { id: "ai-rewrite", section: "IA", label: "Améliorer la rédaction", hint: "Plus clair, même sens", Icon: WandSparkles, keywords: "ia ai ameliorer reformuler rediger", run: "ai:rewrite" },
  { id: "ai-fix", section: "IA", label: "Corriger l'orthographe", hint: "Fautes et ponctuation", Icon: SpellCheck, keywords: "ia ai corriger orthographe fautes grammaire", run: "ai:fix" },
];

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function useIsMac() {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  return mac;
}

/** "Mod+Shift+X" for this keyboard: ⌘⇧X on a Mac, Ctrl+Maj+X elsewhere. */
function keys(combo: string, mac: boolean) {
  const parts = combo.split("+");
  if (mac) return parts.map((p) => ({ Mod: "⌘", Shift: "⇧", Alt: "⌥" })[p] ?? p).join("");
  return parts.map((p) => ({ Mod: "Ctrl", Shift: "Maj" })[p] ?? p).join("+");
}

/** Where the caret is drawn in a textarea, relative to the textarea, by laying the text out in a copy. */
function caretPosition(el: HTMLTextAreaElement, at: number) {
  const style = getComputedStyle(el);
  const div = document.createElement("div");
  for (const p of [
    "boxSizing",
    "width",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderLeftWidth",
    "tabSize",
    "textIndent",
  ] as const)
    div.style[p] = style[p];
  Object.assign(div.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
  div.textContent = el.value.slice(0, at);
  const span = document.createElement("span");
  span.textContent = "\u200b";
  div.append(span);
  document.body.append(div);
  const pos = { top: span.offsetTop - el.scrollTop, left: span.offsetLeft, height: parseFloat(style.lineHeight) || 20 };
  div.remove();
  return pos;
}

/** "blocks": what follows a "/". "notes": picking the note to link to, after "Lien vers une note". */
/** `top` and `bottom` are the caret line's, in the editor area: the menu opens below it, or above when there is no room. */
type Slash = { mode: "blocks" | "notes"; at: number; query: string; index: number; top: number; bottom: number; left: number };

type Options = {
  onUpload: () => void;
  /** Notes that "Lien vers une note" can point to. */
  notes: NoteSummary[];
  /** The AI, when this note may use it. */
  ai: ((action: AiAction, label: string) => void) | null;
};

/** The formatting state of one editor: what the caret is in, the "/" menu, and the key handling. */
export function useFormatting(area: Area, { onUpload, notes, ai }: Options) {
  const [active, setActive] = useState<ReturnType<typeof activeFormats>>({ block: "paragraph", inline: new Set() });
  const [slash, setSlash] = useState<Slash | null>(null);
  const slashRef = useRef(slash);
  useLayoutEffect(() => {
    slashRef.current = slash;
  });

  const exec = useCallback(
    (run: Run | Special, label = "") => {
      const el = area.current;
      if (run === "upload") return onUpload();
      if (!el) return;
      if (run === "note-link") {
        // Same place, same position: the menu now lists notes, filtered by what is typed next.
        const at = el.selectionStart;
        // The menu that was just closed knows where the line is.
        const was = slashRef.current;
        setSlash({ mode: "notes", at, query: "", index: 0, top: was?.top ?? 0, bottom: was?.bottom ?? 0, left: was?.left ?? 0 });
        return;
      }
      if (typeof run === "string") return ai?.(run.slice(3) as AiAction, label);
      applyEdit(el, run(el.value, el.selectionStart, el.selectionEnd));
    },
    [area, onUpload, ai],
  );

  const filter = useCallback(
    (mode: Slash["mode"] | undefined, query: string): Command[] => {
      if (mode === "notes") {
        const q = normalize(query.trim());
        return notes
          .filter((n) => !q || normalize(n.title || "Sans titre").includes(q))
          .slice(0, 30)
          .map((n) => ({
            id: n.id,
            section: "Notes",
            label: n.title || "Sans titre",
            hint: n.encrypted ? "Note chiffrée" : n.excerpt || "Note vide",
            Icon: FileText,
            keywords: "",
            run: (_t, s, e) => noteLink(s, e, n),
          }));
      }
      if (mode !== "blocks") return [];
      const all = ai ? [...BLOCKS, ...AI_COMMANDS] : BLOCKS;
      const q = normalize(query);
      if (!q) return all;
      // Best matches first: the name starting with what was typed, then a word of the name, then the keywords.
      const rank = (c: Command) => {
        const label = normalize(c.label);
        if (label.startsWith(q)) return 0;
        if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 1;
        if (label.includes(q)) return 2;
        return normalize(c.keywords).includes(q) ? 3 : 9;
      };
      return all
        .map((c) => [rank(c), c] as const)
        .filter(([r]) => r < 9)
        .sort((a, b) => a[0] - b[0])
        .map(([, c]) => c);
    },
    [notes, ai],
  );
  const matches = useMemo(() => filter(slash?.mode, slash?.query ?? ""), [filter, slash?.mode, slash?.query]);
  /** What the menu lists right now. Read from the text, because a fast typist presses Enter before the menu's state catches up. */
  const live = useCallback((el: HTMLTextAreaElement, s: Slash) => filter(s.mode, el.value.slice(s.mode === "notes" ? s.at : s.at + 1, el.selectionStart)), [filter]);

  const choose = useCallback(
    (c: Command) => {
      const el = area.current;
      const s = slashRef.current;
      setSlash(null);
      if (!el || !s) return;
      // Take the "/query" (or the note filter) away, then insert the block where it was.
      if (el.selectionStart > s.at) applyEdit(el, { from: s.at, to: el.selectionStart, insert: "", selStart: s.at, selEnd: s.at });
      exec(c.run, c.label);
    },
    [area, exec],
  );

  // Follow the caret: light up the toolbar, and keep the "/" menu in step with what is typed after the slash.
  useEffect(() => {
    const onSel = () => {
      const el = area.current;
      if (!el || document.activeElement !== el) return;
      setActive(activeFormats(el.value, el.selectionStart, el.selectionEnd));
      const s = slashRef.current;
      if (!s) return;
      const caret = el.selectionStart;
      if (s.mode === "notes") {
        const query = el.value.slice(s.at, caret);
        if (caret < s.at || el.selectionEnd !== caret || query.includes("\n") || query.length > 60) setSlash(null);
        else if (query !== s.query) setSlash({ ...s, query, index: 0 });
        return;
      }
      const query = el.value.slice(s.at + 1, caret);
      if (el.value[s.at] !== "/" || caret <= s.at || el.selectionEnd !== caret || /\s/.test(query) || query.length > 24) setSlash(null);
      else if (query !== s.query) setSlash({ ...s, query, index: 0 });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [area]);

  // Nothing matches what follows the slash: it was just a slash.
  useEffect(() => {
    if (slash?.mode === "blocks" && slash.query && !matches.length) setSlash(null);
  }, [slash, matches.length]);

  /** For the textarea's onInput: a "/" typed at the start of a line or after a space opens the menu. */
  const onInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const data = (e.nativeEvent as InputEvent).data;
    const caret = el.selectionStart;
    if (data === "/" && el.selectionEnd === caret && (caret === 1 || /\s/.test(el.value[caret - 2]))) {
      const pos = caretPosition(el, caret - 1);
      const top = el.offsetTop + pos.top;
      setSlash({ mode: "blocks", at: caret - 1, query: "", index: 0, top, bottom: top + pos.height, left: Math.min(el.offsetLeft + pos.left, el.offsetLeft + el.clientWidth - 268) });
    }
  }, []);

  const mac = useIsMac();

  /** For the textarea's onKeyDown: the "/" menu, the shortcuts, and lists that continue on Enter. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      const s = slashRef.current;
      if (s && s.mode === "notes" && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSlash(null);
        return;
      }
      const list = s ? live(el, s) : [];
      if (s && list.length) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const n = list.length;
          setSlash({ ...s, index: (s.index + (e.key === "ArrowDown" ? 1 : -1) + n) % n });
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          // The highlighted row, unless the list changed under it since.
          choose(list[s.query === el.value.slice(s.mode === "notes" ? s.at : s.at + 1, el.selectionStart) ? Math.min(s.index, list.length - 1) : 0]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setSlash(null);
          return;
        }
      }
      if (e.nativeEvent.isComposing) return;

      const mod = mac ? e.metaKey : e.ctrlKey;
      const k = e.key.toLowerCase();
      const go = (run: Run | null | undefined | Edit) => {
        if (!run) return false;
        e.preventDefault();
        e.stopPropagation();
        if (typeof run === "function") exec(run);
        else applyEdit(el, run);
        return true;
      };

      if (mod && !e.altKey) {
        if (!e.shiftKey && k === "b") return go(inline("bold"));
        if (!e.shiftKey && k === "i") return go(inline("italic"));
        if (!e.shiftKey && k === "e") return go(inline("code"));
        if (e.shiftKey && k === "x") return go(inline("strike"));
        // Cmd+K stays the search, except on selected words, where it makes them a link (as in most editors).
        if (!e.shiftKey && k === "k" && el.selectionStart !== el.selectionEnd) return go(link);
        if (e.shiftKey && e.code === "Digit7") return go(block("numbered"));
        if (e.shiftKey && e.code === "Digit8") return go(block("bullet"));
        if (e.shiftKey && e.code === "Digit9") return go(block("task"));
      }
      if (mod && e.altKey && !e.shiftKey) {
        // e.code: Alt+digit types a symbol on a Mac and on AZERTY, the physical key stays the same.
        const h = { Digit0: "paragraph", Digit1: "h1", Digit2: "h2", Digit3: "h3" }[e.code] as BlockFormat | undefined;
        if (h) return go(block(h));
        if (e.code === "KeyC") return go(codeBlock);
      }
      if (!mod && !e.altKey && !e.metaKey && !e.ctrlKey) {
        if (e.key === "Enter" && !e.shiftKey) return go(continueList(el.value, el.selectionStart, el.selectionEnd));
        if (e.key === "Tab") return go(indentList(el.value, el.selectionStart, el.selectionEnd, e.shiftKey));
      }
    },
    [mac, live, choose, exec],
  );

  return { active, exec, slash, matches, choose, setSlash, onInput, onKeyDown, mac, close: () => setSlash(null) };
}

export type Formatting = ReturnType<typeof useFormatting>;

type Tool = { label: string; Icon: typeof Bold; run: Run | Special; on?: boolean; keys?: string };

/** The formatting bar above the editor. Buttons never take the focus, so the selection stays in the text. */
export function FormatToolbar({ fmt, disabled }: { fmt: Formatting; disabled?: boolean }) {
  const { active, mac } = fmt;
  const [help, setHelp] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!help) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !helpRef.current?.contains(e.target as Node)) setHelp(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [help]);

  const groups: Tool[][] = [
    [
      { label: "Titre 1", Icon: Heading1, run: block("h1"), on: active.block === "h1", keys: "Mod+Alt+1" },
      { label: "Titre 2", Icon: Heading2, run: block("h2"), on: active.block === "h2", keys: "Mod+Alt+2" },
      { label: "Titre 3", Icon: Heading3, run: block("h3"), on: active.block === "h3", keys: "Mod+Alt+3" },
    ],
    [
      { label: "Gras", Icon: Bold, run: inline("bold"), on: active.inline.has("bold"), keys: "Mod+B" },
      { label: "Italique", Icon: Italic, run: inline("italic"), on: active.inline.has("italic"), keys: "Mod+I" },
      { label: "Barré", Icon: Strikethrough, run: inline("strike"), on: active.inline.has("strike"), keys: "Mod+Shift+X" },
      { label: "Code", Icon: Code, run: inline("code"), on: active.inline.has("code"), keys: "Mod+E" },
      { label: "Lien", Icon: LinkIcon, run: link, keys: "Mod+K" },
    ],
    [
      { label: "Liste à puces", Icon: List, run: block("bullet"), on: active.block === "bullet", keys: "Mod+Shift+8" },
      { label: "Liste numérotée", Icon: ListOrdered, run: block("numbered"), on: active.block === "numbered", keys: "Mod+Shift+7" },
      { label: "Liste de tâches", Icon: ListTodo, run: block("task"), on: active.block === "task", keys: "Mod+Shift+9" },
    ],
    [
      { label: "Citation", Icon: Quote, run: block("quote"), on: active.block === "quote" },
      { label: "Bloc de code", Icon: SquareCode, run: codeBlock, keys: "Mod+Alt+C" },
      { label: "Tableau", Icon: Table, run: table },
      { label: "Séparateur", Icon: Minus, run: divider },
      { label: "Image, vidéo ou fichier", Icon: ImagePlus, run: "upload" },
    ],
  ];

  return (
    <div className="relative flex items-center border-b border-line px-5 max-md:px-2" role="toolbar" aria-label="Mise en forme">
      <div className="scroll-thin flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1.5">
        {groups.map((g, i) => (
          <div key={i} className="flex shrink-0 items-center gap-0.5">
            {i > 0 && <span className="mx-1.5 h-4 w-px bg-line-strong" aria-hidden />}
            {g.map((t) => (
              <button
                key={t.label}
                type="button"
                disabled={disabled}
                aria-label={t.label}
                aria-pressed={t.on ?? undefined}
                title={t.keys ? `${t.label} (${keys(t.keys, mac)})` : t.label}
                // Keep the focus (and the selection) in the text.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => fmt.exec(t.run)}
                className={cn(
                  "press flex size-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-40",
                  t.on ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-ink/5 hover:text-ink",
                )}
              >
                <t.Icon className="size-[15px]" strokeWidth={t.Icon === Bold ? 2.5 : 2} />
              </button>
            ))}
          </div>
        ))}
      </div>
      <div ref={helpRef} className="relative ml-1 shrink-0">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setHelp((h) => !h)}
          aria-expanded={help}
          title="Aide à la mise en forme"
          className={cn("flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] transition-colors duration-150", help ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-ink/5 hover:text-ink")}
        >
          <CircleHelp className="size-3.5" />
          <span className="max-lg:hidden">Aide</span>
        </button>
        {help && <HelpCard mac={mac} />}
      </div>
    </div>
  );
}

const CHEATSHEET: [string, string, string?][] = [
  ["Gras", "**texte**", "Mod+B"],
  ["Italique", "*texte*", "Mod+I"],
  ["Barré", "~~texte~~", "Mod+Shift+X"],
  ["Code", "`code`", "Mod+E"],
  ["Lien", "[texte](https://…)", "Mod+K"],
  ["Titres", "# Titre · ## · ###", "Mod+Alt+1"],
  ["Liste", "- élément", "Mod+Shift+8"],
  ["Liste numérotée", "1. élément", "Mod+Shift+7"],
  ["Tâche", "- [ ] à faire", "Mod+Shift+9"],
  ["Citation", "> texte"],
  ["Image", "![description](lien)"],
];

function HelpCard({ mac }: { mac: boolean }) {
  return (
    <div className="pop-in absolute right-0 top-9 z-30 w-[340px] max-w-[calc(100vw-24px)] rounded-xl border border-line bg-surface p-3 shadow-card">
      <p className="text-[13px] font-medium">Mettre en forme sans connaître le Markdown</p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
        Sélectionne du texte puis clique un bouton de la barre, ou tape <Kbd>/</Kbd> en début de ligne pour choisir un bloc. Le texte reste du Markdown, visible tel quel.
      </p>
      <table className="mt-2.5 w-full text-[12px]">
        <tbody>
          {CHEATSHEET.map(([label, syntax, combo]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-1.5 pr-2 text-ink-2">{label}</td>
              <td className="py-1.5 pr-2 font-mono text-[11.5px] text-ink">{syntax}</td>
              <td className="py-1.5 text-right">{combo && <Kbd>{keys(combo, mac)}</Kbd>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11.5px] text-ink-3">Dans une liste, Entrée crée l&apos;élément suivant et Tab le met en retrait.</p>
    </div>
  );
}

/** The "/" menu, under the caret. */
export function SlashMenu({ fmt }: { fmt: Formatting }) {
  const { slash, matches } = fmt;
  const list = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState(false);
  useEffect(() => {
    list.current?.querySelector("[data-active=true]")?.scrollIntoView({ block: "nearest" });
  }, [slash?.index]);
  // Below the line, unless the menu would run past the bottom of the editor and fits above.
  const top = slash?.top ?? 0;
  const bottom = slash?.bottom ?? 0;
  useLayoutEffect(() => {
    const el = list.current;
    const room = el?.parentElement?.clientHeight;
    if (!el || !room) return;
    const h = el.offsetHeight;
    setAbove(bottom + 4 + h > room && top - 4 - h >= 0);
  }, [top, bottom, matches.length]);
  if (!slash || (slash.mode === "blocks" && !matches.length)) return null;
  const index = Math.min(slash.index, matches.length - 1);
  const notes = slash.mode === "notes";
  return (
    <div
      ref={list}
      role="listbox"
      aria-label={notes ? "Choisir une note" : "Insérer un bloc"}
      style={{ top: above ? slash.top - 4 - (list.current?.offsetHeight ?? 0) : slash.bottom + 4, left: Math.max(8, slash.left) }}
      className="scroll-thin pop-in absolute z-30 max-h-[340px] w-[280px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-card"
    >
      {notes && <p className="px-2 pb-1 pt-1.5 text-[11.5px] text-ink-3">Tape quelques lettres du titre de la note</p>}
      {notes && !matches.length && <p className="px-2 py-2 text-[12.5px] text-ink-3">Aucune note ne correspond</p>}
      {matches.map((c, i) => (
        <div key={c.id}>
          {c.section !== matches[i - 1]?.section && !notes && <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">{c.section}</p>}
          <button
            type="button"
            role="option"
            aria-selected={i === index}
            data-active={i === index}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => fmt.setSlash((s) => (s ? { ...s, index: i } : s))}
            onClick={() => fmt.choose(c)}
            className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left", i === index ? "bg-accent-soft" : "hover:bg-ink/5")}
          >
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2", i === index ? "text-accent" : "text-ink-2")}>
              <c.Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-ink">{c.label}</span>
              <span className="block truncate text-[11.5px] text-ink-3">{c.hint}</span>
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
