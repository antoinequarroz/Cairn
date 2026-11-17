// Formatting commands for the Markdown editor, for people who don't know Markdown by heart: the
// toolbar, the keyboard shortcuts and the "/" menu all go through here. Pure functions over the
// text and the selection, so they are tested without a browser.

/** One change to the text: replace [from, to) with `insert`, then select [selStart, selEnd). */
export type Edit = { from: number; to: number; insert: string; selStart: number; selEnd: number };

export type InlineFormat = "bold" | "italic" | "strike" | "code";
export type BlockFormat = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "numbered" | "task" | "quote";

const INLINE: Record<InlineFormat, { mark: string; placeholder: string }> = {
  bold: { mark: "**", placeholder: "texte en gras" },
  italic: { mark: "*", placeholder: "texte en italique" },
  strike: { mark: "~~", placeholder: "texte barré" },
  code: { mark: "`", placeholder: "code" },
};

const lineStart = (text: string, at: number) => text.lastIndexOf("\n", at - 1) + 1;
const lineEnd = (text: string, at: number) => {
  const i = text.indexOf("\n", at);
  return i === -1 ? text.length : i;
};

/** How many times `ch` repeats right before `at` (dir -1) or from `at` on (dir 1). */
function run(text: string, at: number, ch: string, dir: 1 | -1) {
  let n = 0;
  for (let i = dir === 1 ? at : at - 1; i >= 0 && i < text.length && text[i] === ch; i += dir) n++;
  return n;
}

/** Whether the mark sits on both sides of [start, end). "*" and "**" share a character, so runs are counted. */
function wrapped(text: string, start: number, end: number, mark: string) {
  if (mark === "*") {
    const a = run(text, start, "*", -1);
    const b = run(text, end, "*", 1);
    return a % 2 === 1 && b % 2 === 1;
  }
  if (mark === "**") return run(text, start, "*", -1) >= 2 && run(text, end, "*", 1) >= 2;
  return text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark;
}

/**
 * Bold, italic, strikethrough or inline code on the selection, or off again when it already has it.
 * With nothing selected, a placeholder is inserted and selected, ready to be typed over.
 */
export function toggleInline(text: string, start: number, end: number, format: InlineFormat): Edit {
  const { mark, placeholder } = INLINE[format];
  const m = mark.length;
  // "**mot **" does not render: leave the spaces around the selection outside the marks.
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;

  if (start === end) {
    // Caret right inside an empty pair ("****"): take it away.
    if (wrapped(text, start, end, mark) && text.slice(start - m, start + m) === mark + mark) return { from: start - m, to: start + m, insert: "", selStart: start - m, selEnd: start - m };
    const insert = mark + placeholder + mark;
    return { from: start, to: end, insert, selStart: start + m, selEnd: start + m + placeholder.length };
  }

  const inner = text.slice(start, end);
  // The marks are just outside the selection: **[mot]**
  if (wrapped(text, start, end, mark)) return { from: start - m, to: end + m, insert: inner, selStart: start - m, selEnd: end - m };
  // The selection includes the marks: [**mot**]
  if (inner.length >= 2 * m && inner.startsWith(mark) && inner.endsWith(mark) && wrapped(inner, m, inner.length - m, mark)) {
    const bare = inner.slice(m, -m);
    return { from: start, to: end, insert: bare, selStart: start, selEnd: start + bare.length };
  }
  // Marks don't span lines in Markdown: format each line of a multi-line selection.
  const insert = inner
    .split("\n")
    .map((l) => (l.trim() ? l.replace(/^(\s*)(.*?)(\s*)$/, `$1${mark}$2${mark}$3`) : l))
    .join("\n");
  return { from: start, to: end, insert, selStart: start + (insert.includes("\n") ? 0 : m), selEnd: start + insert.length - (insert.includes("\n") ? 0 : m) };
}

// Indentation, then any block marker a line can start with.
const PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

/** What kind of block a line is. */
export function blockOf(line: string): BlockFormat {
  const p = (line.match(PREFIX)?.[2] ?? "").trim();
  if (/^#$/.test(p)) return "h1";
  if (/^##$/.test(p)) return "h2";
  if (/^#{3,6}$/.test(p)) return "h3";
  if (p.startsWith(">")) return "quote";
  if (/\[[ xX]\]$/.test(p)) return "task";
  if (/^[-*+]$/.test(p)) return "bullet";
  if (/^\d+[.)]$/.test(p)) return "numbered";
  return "paragraph";
}

function prefixFor(format: BlockFormat, n: number) {
  switch (format) {
    case "h1":
      return "# ";
    case "h2":
      return "## ";
    case "h3":
      return "### ";
    case "bullet":
      return "- ";
    case "numbered":
      return `${n}. `;
    case "task":
      return "- [ ] ";
    case "quote":
      return "> ";
    default:
      return "";
  }
}

/**
 * Turns the lines of the selection into headings, a list, a checklist or a quote. When they all
 * already are that, they go back to plain text. Any other marker on the line is replaced.
 */
export function setBlock(text: string, start: number, end: number, format: BlockFormat): Edit {
  const from = lineStart(text, start);
  // A selection ending at the very start of a line doesn't take that line along.
  const to = lineEnd(text, end > start && text[end - 1] === "\n" ? end - 1 : end);
  const lines = text.slice(from, to).split("\n");
  const filled = lines.filter((l) => l.trim());
  const off = format !== "paragraph" && filled.length > 0 && filled.every((l) => blockOf(l) === format);
  const target = off ? "paragraph" : format;

  let n = 0;
  let firstDelta = 0;
  const out = lines.map((line, i) => {
    const [whole, indent] = line.match(PREFIX) ?? ["", ""];
    // An empty line stays empty inside a selection, but a lone empty line gets its marker.
    if (!line.trim() && lines.length > 1) return line;
    // Headings and quotes don't nest: they start at the margin.
    const keep = target === "bullet" || target === "numbered" || target === "task" ? indent : "";
    const next = keep + prefixFor(target, ++n) + line.slice(whole.length);
    if (i === 0) firstDelta = next.length - line.length;
    return next;
  });
  const insert = out.join("\n");
  if (start === end) {
    // Keep the caret where it was in the words, never inside the new marker.
    const caret = Math.max(start + firstDelta, from + (out[0].match(PREFIX)?.[0].length ?? 0));
    return { from, to, insert, selStart: caret, selEnd: caret };
  }
  return { from, to, insert, selStart: start === from ? from : start + firstDelta, selEnd: from + insert.length };
}

/** Puts `block` on lines of its own at the caret (or in place of the selection), with a blank line around it. */
export function insertBlock(text: string, start: number, end: number, block: string, select?: [number, number]): Edit {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : after ? "\n\n" : "\n";
  const insert = lead + block + trail;
  const at = start + lead.length;
  const [a, b] = select ?? [block.length, block.length];
  return { from: start, to: end, insert, selStart: at + a, selEnd: at + b };
}

/** A fenced code block around the selected lines, or an empty one to type into. */
export function codeBlock(text: string, start: number, end: number): Edit {
  if (start === end) {
    const from = lineStart(text, start);
    const line = text.slice(from, lineEnd(text, start));
    // On an empty line, the block goes right there.
    if (!line.trim()) return insertBlock(text, from, lineEnd(text, start), "```\n\n```", [4, 4]);
    return insertBlock(text, lineEnd(text, start), lineEnd(text, start), "```\n\n```", [4, 4]);
  }
  const from = lineStart(text, start);
  const to = lineEnd(text, end > start && text[end - 1] === "\n" ? end - 1 : end);
  const body = text.slice(from, to);
  return insertBlock(text, from, to, "```\n" + body + "\n```", [4, 4 + body.length]);
}

const URL_RE = /^(https?:\/\/|mailto:|\/)\S+$/i;

/**
 * A link. Selected words become the link's text and the address gets selected to paste over;
 * a selected address becomes the address and the text gets selected.
 */
export function link(text: string, start: number, end: number): Edit {
  const sel = text.slice(start, end).trim();
  if (URL_RE.test(sel)) {
    const label = "texte du lien";
    return { from: start, to: end, insert: `[${label}](${sel})`, selStart: start + 1, selEnd: start + 1 + label.length };
  }
  const label = sel || "texte du lien";
  const insert = `[${label}](https://)`;
  const urlAt = start + label.length + 3;
  return sel ? { from: start, to: end, insert, selStart: urlAt, selEnd: urlAt + "https://".length } : { from: start, to: end, insert, selStart: start + 1, selEnd: start + 1 + label.length };
}

export const TABLE = "| Colonne 1 | Colonne 2 | Colonne 3 |\n| --- | --- | --- |\n| | | |\n| | | |";

export function table(text: string, start: number, end: number): Edit {
  return insertBlock(text, start, end, TABLE, [2, 11]);
}

export function divider(text: string, start: number, end: number): Edit {
  return insertBlock(text, start, end, "---");
}

export function imageByUrl(text: string, start: number, end: number): Edit {
  const label = text.slice(start, end).trim() || "description";
  const insert = `![${label}](https://)`;
  const urlAt = start + label.length + 4;
  return { from: start, to: end, insert, selStart: urlAt, selEnd: urlAt + "https://".length };
}

/**
 * Enter at the end of a list item starts the next item (next number, empty box). Enter on an empty
 * item ends the list instead. Returns null when Enter should just break the line.
 */
export function continueList(text: string, start: number, end: number): Edit | null {
  if (start !== end) return null;
  const from = lineStart(text, start);
  const line = text.slice(from, lineEnd(text, start));
  const m = line.match(/^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/);
  // Not on a list line, or the caret is still inside the marker.
  if (!m || start - from < m[0].length) return null;
  const [marker, indent, kind] = m;
  if (!line.slice(marker.length).trim()) {
    // An empty item: leave the list (or go up one level when indented).
    if (indent) {
      const out = indent.slice(Math.min(indent.length, 2)) + kind;
      return { from, to: from + marker.length, insert: out, selStart: from + out.length, selEnd: from + out.length };
    }
    // A blank line, so the next paragraph isn't read as part of the last item.
    return { from, to: from + line.length, insert: "\n", selStart: from + 1, selEnd: from + 1 };
  }
  let next = kind;
  const num = kind.match(/^(\d+)([.)])(\s+)$/);
  if (num) next = `${Number(num[1]) + 1}${num[2]}${num[3]}`;
  else if (/\[[xX]\]/.test(kind)) next = kind.replace(/\[[xX]\]/, "[ ]");
  const insert = "\n" + indent + next;
  return { from: start, to: start, insert, selStart: start + insert.length, selEnd: start + insert.length };
}

/** Tab / Shift+Tab on list lines: one level in or out. Null when the lines are not a list, so Tab keeps moving focus. */
export function indentList(text: string, start: number, end: number, out: boolean): Edit | null {
  const from = lineStart(text, start);
  const to = lineEnd(text, end > start && text[end - 1] === "\n" ? end - 1 : end);
  const lines = text.slice(from, to).split("\n");
  if (!lines.every((l) => !l.trim() || ["bullet", "numbered", "task"].includes(blockOf(l)))) return null;
  let first = 0;
  let total = 0;
  const next = lines.map((l, i) => {
    let r = l;
    if (l.trim()) r = out ? l.replace(/^( {1,2}|\t)/, "") : "  " + l;
    if (i === 0) first = r.length - l.length;
    total += r.length - l.length;
    return r;
  });
  const insert = next.join("\n");
  return { from, to, insert, selStart: Math.max(from, start + first), selEnd: Math.max(from, end + total) };
}

/** What the caret sits in, to light up the toolbar buttons. A best guess on the current line. */
export function activeFormats(text: string, start: number, end: number) {
  const from = lineStart(text, start);
  const line = text.slice(from, lineEnd(text, start));
  const before = line.slice(0, start - from);
  const after = line.slice(end - from);
  const odd = (s: string, re: RegExp) => (s.match(re)?.length ?? 0) % 2 === 1;
  const inline = new Set<InlineFormat>();
  const code = odd(before, /`/g) && after.includes("`");
  if (code) inline.add("code");
  else {
    const b = before.replace(/`[^`]*`/g, "");
    const a = after.replace(/`[^`]*`/g, "");
    if (odd(b, /\*\*/g) && a.includes("**")) inline.add("bold");
    if (odd(b.replace(/\*\*/g, ""), /\*/g) && /\*/.test(a.replace(/\*\*/g, ""))) inline.add("italic");
    if (odd(b, /~~/g) && a.includes("~~")) inline.add("strike");
  }
  return { block: blockOf(line), inline };
}

/** A highlighted box: a quote that opens with an emoji and a bold label, the text to type selected. */
export function callout(text: string, start: number, end: number, emoji: string, label: string): Edit {
  const body = text.slice(start, end).trim() || "Ton texte ici";
  const head = `> ${emoji} **${label}**\n> `;
  const quoted = body.split("\n").join("\n> ");
  return insertBlock(text, start, end, head + quoted, [head.length, head.length + quoted.length]);
}

/** A section that opens on a click (HTML <details>, which Markdown lets through). */
export function toggleBlock(text: string, start: number, end: number): Edit {
  const body = text.slice(start, end).trim() || "Contenu caché";
  const title = "Titre du bloc";
  const block = `<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
  const at = "<details>\n<summary>".length;
  return insertBlock(text, start, end, block, [at, at + title.length]);
}

/** A code block for a given language, e.g. "bash" for terminal commands. */
export function fencedCode(text: string, start: number, end: number, lang: string): Edit {
  const body = text.slice(start, end);
  const open = "```" + lang + "\n";
  return insertBlock(text, start, end, open + body + "\n```", [open.length, open.length + body.length]);
}

/** Plain text at the caret, in place of the selection. */
export function insertText(start: number, end: number, value: string): Edit {
  return { from: start, to: end, insert: value, selStart: start + value.length, selEnd: start + value.length };
}

/** A link to another note of Cairn. Brackets in the title would end the link text early. */
export function noteLink(start: number, end: number, note: { id: string; title: string }): Edit {
  return insertText(start, end, `[${(note.title || "Sans titre").replace(/[[\]]/g, "")}](/notes/${note.id})`);
}
