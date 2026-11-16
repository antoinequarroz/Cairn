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

/** Markdown to safe HTML. Notes can hold pasted content: nothing in them may run script. */
export function renderMarkdown(source: string) {
  const html = marked.parse(source, { async: false });
  return DOMPurify.sanitize(html, { ADD_TAGS: ["video", "audio"], ADD_ATTR: ["controls", "playsinline", "preload", "target"], FORBID_TAGS: ["style", "form"] });
}

/** The Markdown to insert for an uploaded file. */
export function markdownForFile(name: string, mime: string, url: string) {
  const label = name.replace(/[\[\]]/g, "");
  return /^(image|video|audio)\//.test(mime) ? `![${label}](${url})` : `[${label}](${url})`;
}
