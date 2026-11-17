"use client";

import {
  Bold,
  CircleHelp,
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
import { activeFormats, codeBlock, continueList, divider, imageByUrl, indentList, link, setBlock, table, toggleInline, type BlockFormat, type Edit, type InlineFormat } from "@/lib/md-format";
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

/** Every block that can be inserted: the toolbar, the shortcuts and the "/" menu share them. */
type Command = {
  id: string;
  label: string;
  hint: string;
  Icon: typeof Bold;
  keywords: string;
  /** "upload" opens the file picker instead of writing text. */
  run: Run | "upload";
};

const block =
  (f: BlockFormat): Run =>
  (t, s, e) =>
    setBlock(t, s, e, f);
const inline =
  (f: InlineFormat): Run =>
  (t, s, e) =>
    toggleInline(t, s, e, f);

export const BLOCKS: Command[] = [
  { id: "paragraph", label: "Texte", hint: "Un paragraphe normal", Icon: Pilcrow, keywords: "texte paragraphe normal text", run: block("paragraph") },
  { id: "h1", label: "Titre 1", hint: "Grand titre de section", Icon: Heading1, keywords: "titre h1 heading grand", run: block("h1") },
  { id: "h2", label: "Titre 2", hint: "Titre moyen", Icon: Heading2, keywords: "titre h2 heading sous-titre", run: block("h2") },
  { id: "h3", label: "Titre 3", hint: "Petit titre", Icon: Heading3, keywords: "titre h3 heading", run: block("h3") },
  { id: "bullet", label: "Liste à puces", hint: "Une liste simple", Icon: List, keywords: "liste puces bullet ul", run: block("bullet") },
  { id: "numbered", label: "Liste numérotée", hint: "1, 2, 3…", Icon: ListOrdered, keywords: "liste numerotee numérotée ordonnee ol nombre", run: block("numbered") },
  { id: "task", label: "Liste de tâches", hint: "Des cases à cocher", Icon: ListTodo, keywords: "taches tâches todo checklist case cocher", run: block("task") },
  { id: "quote", label: "Citation", hint: "Un passage mis en retrait", Icon: Quote, keywords: "citation quote retrait", run: block("quote") },
  { id: "code", label: "Bloc de code", hint: "Du code sur plusieurs lignes", Icon: SquareCode, keywords: "code bloc programme script", run: codeBlock },
  { id: "table", label: "Tableau", hint: "Trois colonnes à remplir", Icon: Table, keywords: "tableau table colonnes grille", run: table },
  { id: "divider", label: "Séparateur", hint: "Une ligne horizontale", Icon: Minus, keywords: "separateur séparateur ligne divider hr", run: divider },
  { id: "upload", label: "Image, vidéo ou fichier", hint: "Depuis ton appareil", Icon: ImagePlus, keywords: "image photo video vidéo fichier joindre upload media", run: "upload" },
  { id: "image-url", label: "Image par lien", hint: "Une image déjà en ligne", Icon: ImageIcon, keywords: "image lien url web", run: imageByUrl },
  { id: "link", label: "Lien", hint: "Vers une page web", Icon: LinkIcon, keywords: "lien link url web", run: link },
];

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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
  span.textContent = "​";
  div.append(span);
  document.body.append(div);
  const pos = { top: span.offsetTop - el.scrollTop, left: span.offsetLeft, height: parseFloat(style.lineHeight) || 20 };
  div.remove();
  return pos;
}

type Slash = { at: number; query: string; index: number; top: number; left: number };

/** The formatting state of one editor: what the caret is in, the "/" menu, and the key handling. */
export function useFormatting(area: Area, onUpload: () => void) {
  const [active, setActive] = useState<ReturnType<typeof activeFormats>>({ block: "paragraph", inline: new Set() });
  const [slash, setSlash] = useState<Slash | null>(null);
  const slashRef = useRef(slash);
  useLayoutEffect(() => {
    slashRef.current = slash;
  });

  const exec = useCallback(
    (run: Run | "upload") => {
      const el = area.current;
      if (run === "upload") return onUpload();
      if (!el) return;
      applyEdit(el, run(el.value, el.selectionStart, el.selectionEnd));
    },
    [area, onUpload],
  );

  const query = slash?.query;
  const open = !!slash;
  const matches = useMemo(() => (open ? BLOCKS.filter((c) => !query || normalize(`${c.label} ${c.keywords}`).includes(normalize(query))) : []), [open, query]);

  const choose = useCallback(
    (c: Command) => {
      const el = area.current;
      const s = slashRef.current;
      setSlash(null);
      if (!el || !s) return;
      // Take the "/query" away, then insert the block where it was.
      applyEdit(el, { from: s.at, to: el.selectionStart, insert: "", selStart: s.at, selEnd: s.at });
      exec(c.run);
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
      const query = el.value.slice(s.at + 1, caret);
      if (el.value[s.at] !== "/" || caret <= s.at || el.selectionEnd !== caret || /\s/.test(query) || query.length > 24) setSlash(null);
      else if (query !== s.query) setSlash({ ...s, query, index: 0 });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [area]);

  // Nothing matches what follows the slash: it was just a slash.
  useEffect(() => {
    if (slash && slash.query && !matches.length) setSlash(null);
  }, [slash, matches.length]);

  /** For the textarea's onInput: a "/" typed at the start of a line or after a space opens the menu. */
  const onInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const data = (e.nativeEvent as InputEvent).data;
    const caret = el.selectionStart;
    if (data === "/" && el.selectionEnd === caret && (caret === 1 || /\s/.test(el.value[caret - 2]))) {
      const pos = caretPosition(el, caret - 1);
      const below = el.offsetTop + pos.top + pos.height + 4;
      // Near the bottom of the editor, the menu opens above the line instead.
      const room = (el.offsetParent?.clientHeight ?? Infinity) - below;
      const top = room < 220 && pos.top > 220 ? el.offsetTop + pos.top - 4 - Math.min(300, pos.top) : below;
      setSlash({ at: caret - 1, query: "", index: 0, top, left: Math.min(el.offsetLeft + pos.left, el.offsetLeft + el.clientWidth - 268) });
    }
  }, []);

  const mac = useIsMac();

  /** For the textarea's onKeyDown: the "/" menu, the shortcuts, and lists that continue on Enter. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      const s = slashRef.current;
      if (s && matches.length) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const n = matches.length;
          setSlash({ ...s, index: (s.index + (e.key === "ArrowDown" ? 1 : -1) + n) % n });
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          choose(matches[Math.min(s.index, matches.length - 1)]);
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
    [mac, matches, choose, exec],
  );

  return { active, exec, slash, matches, choose, setSlash, onInput, onKeyDown, mac, close: () => setSlash(null) };
}

export type Formatting = ReturnType<typeof useFormatting>;

type Tool = { label: string; Icon: typeof Bold; run: Run | "upload"; on?: boolean; keys?: string };

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
  useEffect(() => {
    list.current?.querySelector("[data-active=true]")?.scrollIntoView({ block: "nearest" });
  }, [slash?.index]);
  if (!slash || !matches.length) return null;
  const index = Math.min(slash.index, matches.length - 1);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Insérer un bloc"
      style={{ top: slash.top, left: Math.max(8, slash.left) }}
      className="scroll-thin pop-in absolute z-30 max-h-[300px] w-[260px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-card"
    >
      <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">Insérer</p>
      {matches.map((c, i) => (
        <button
          key={c.id}
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
            <span className="block text-[13px] font-medium text-ink">{c.label}</span>
            <span className="block truncate text-[11.5px] text-ink-3">{c.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
