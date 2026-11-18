"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { codeLabel, isNoteLink } from "@/lib/markdown";
import { matchSuiteLink, type SuiteApp } from "@/lib/suite";
import { useSuite } from "@/lib/suite-context";
import { cn } from "@/lib/utils";

// Lucide's "copy" and "check", inline: the buttons are added to sanitized HTML, outside React.
const COPY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Without HTTPS (or without permission) the Clipboard API is missing: fall back to a hidden field.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    Object.assign(area.style, { position: "fixed", opacity: "0" });
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/**
 * Gives each code block a header with its language and a copy button. Done on the HTML string, after
 * sanitizing, so React stays the only one writing the article's content.
 */
export function withCodeBlocks(html: string) {
  if (!html.includes("<pre") || typeof document === "undefined") return html;
  const t = document.createElement("template");
  t.innerHTML = html;
  for (const pre of t.content.querySelectorAll("pre")) {
    const code = pre.querySelector("code");
    const box = document.createElement("div");
    box.className = "code-block";
    const bar = document.createElement("div");
    bar.className = "code-bar";
    const label = document.createElement("span");
    label.textContent = codeLabel(code?.className ?? "");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.title = "Copier";
    button.setAttribute("aria-label", "Copier le code");
    button.innerHTML = COPY;
    bar.append(label, button);
    pre.replaceWith(box);
    box.append(bar, pre);
  }
  return t.innerHTML;
}

/**
 * Links to the other apps of the suite (Alfred, Metricove…). Alone on its line, a link becomes a card
 * (app, kind, title); inside a sentence, it gets the app's dot. Done on the sanitized HTML string, like
 * the code blocks: only classes, text and a colour are added, and the link keeps its address.
 */
export function withSuiteLinks(html: string, apps: SuiteApp[]) {
  if (!apps.length || !html.includes("<a") || typeof document === "undefined") return html;
  const t = document.createElement("template");
  t.innerHTML = html;
  for (const a of t.content.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const match = matchSuiteLink(a.getAttribute("href") ?? "", apps);
    if (!match) continue;
    const { app, kind } = match;
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    a.style.setProperty("--app", app.color);
    const p = a.parentElement;
    const alone = p?.tagName === "P" && p.childNodes.length === 1;
    const text = (a.textContent ?? "").trim();
    if (!alone) {
      a.classList.add("suite-chip");
      a.title = `${kind} · ${app.name}`;
      continue;
    }
    // A bare address says nothing: the card shows where it leads instead.
    const title = !text || text === a.href || text === a.getAttribute("href") ? `${kind} dans ${app.name}` : text;
    const mark = Object.assign(document.createElement("span"), { className: "suite-card-mark", textContent: app.name.slice(0, 1).toUpperCase() });
    const body = Object.assign(document.createElement("span"), { className: "suite-card-body" });
    const meta = Object.assign(document.createElement("span"), { className: "suite-card-meta", textContent: `${app.name} · ${kind}` });
    const name = Object.assign(document.createElement("span"), { className: "suite-card-title", textContent: title });
    body.append(meta, name);
    a.className = "suite-card";
    a.replaceChildren(mark, body);
  }
  return t.innerHTML;
}

/** Rendered Markdown, with a copy button on every code block and cards for the links to the suite. */
export function Prose({ html, className }: { html: string; className?: string }) {
  const { apps } = useSuite();
  const full = useMemo(() => withSuiteLinks(withCodeBlocks(html), apps), [html, apps]);
  const router = useRouter();

  const onClick = async (e: React.MouseEvent) => {
    // A link to a note opens it in the app, without reloading the page. Cmd/Ctrl-click still opens a tab.
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (link && !link.target && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0 && isNoteLink(link.getAttribute("href") ?? "", location.origin)) {
      e.preventDefault();
      router.push(new URL(link.href).pathname);
      return;
    }
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>(".code-copy");
    if (!button) return;
    const pre = button.closest(".code-block")?.querySelector("pre");
    // A code block ends with a line break in Markdown: copy the command, not the empty line after it.
    const text = (pre?.textContent ?? "").replace(/\n$/, "");
    const ok = await copyText(text);
    button.innerHTML = ok ? CHECK : COPY;
    button.title = ok ? "Copié" : "Impossible de copier";
    button.dataset.copied = String(ok);
    setTimeout(() => {
      button.innerHTML = COPY;
      button.title = "Copier";
      delete button.dataset.copied;
    }, 1600);
  };

  return <article className={cn("prose-cairn", className)} onClick={onClick} dangerouslySetInnerHTML={{ __html: full }} />;
}
