// The PostMelo suite, as Cairn sees it: the other apps (for the apps menu and the link cards), and
// the "Note de réunion" that another app opens in Cairn. Pure functions, used on both sides.

export type SuiteApp = {
  name: string;
  /** Origin of the app, "https://alfred.postmelo.ch". */
  url: string;
  /** What it is for, shown under its name in the menu. */
  role: string;
  /** Its accent colour, for the dot on the menu and the cards. */
  color: string;
};

const KNOWN: Record<string, { role: string; color: string }> = {
  cairn: { role: "Notes et coffre", color: "#4f56e8" },
  alfred: { role: "Calendrier", color: "#0f9f8f" },
  metricove: { role: "Réseaux sociaux", color: "#ff5a1f" },
  tickup: { role: "Projets", color: "#2f9e44" },
  lamio: { role: "Suite", color: "#8b5cf6" },
};

/** The apps of the suite when SUITE_APPS is not set. */
export const DEFAULT_SUITE = "Alfred=https://alfred.postmelo.ch,Metricove=https://metricove.postmelo.ch,TickUp=https://tickup.postmelo.ch";

const origin = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
};

/**
 * Reads SUITE_APPS: "Alfred=https://alfred.postmelo.ch,Metricove=https://…". "off" hides the menu and
 * the cards. Entries without a valid web address are left out, and so is Cairn itself (`self`).
 */
export function parseSuite(value: string | undefined, self?: string): SuiteApp[] {
  const raw = (value ?? DEFAULT_SUITE).trim();
  if (raw === "" || raw.toLowerCase() === "off") return [];
  const own = self ? origin(self) : null;
  const apps: SuiteApp[] = [];
  for (const entry of raw.split(",")) {
    const at = entry.indexOf("=");
    if (at < 1) continue;
    const name = entry.slice(0, at).trim().slice(0, 40);
    const url = origin(entry.slice(at + 1).trim());
    if (!name || !url || url === own || apps.some((a) => a.url === url)) continue;
    const known = KNOWN[name.toLowerCase()] ?? { role: "", color: "#6b7280" };
    apps.push({ name, url, ...known });
  }
  return apps;
}

export type SuiteLink = { app: SuiteApp; kind: string };

/** What a link to another app of the suite points at, or null when it leads elsewhere. */
export function matchSuiteLink(href: string, apps: SuiteApp[]): SuiteLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const app = apps.find((a) => a.url === url.origin);
  if (!app) return null;
  return { app, kind: kindOf(url) };
}

function kindOf(url: URL) {
  const path = url.pathname.toLowerCase();
  const issue = url.searchParams.get("issue");
  if (issue && /^[A-Z][A-Z0-9]*-\d+$/.test(issue)) return `Ticket ${issue}`;
  if (/\/(events?|evenements?|rendez-vous|agenda)\b/.test(path)) return "Événement";
  if (/\/(posts?|publications?)\b/.test(path)) return "Publication";
  if (/\/(dashboards?|tableaux?|stats|analytics|insights)\b/.test(path)) return "Tableau";
  if (/\/(issues?|tickets?)\b/.test(path)) return "Ticket";
  if (/^\/p\/[^/]+/.test(path)) return "Projet";
  return "Page";
}

// "Note de réunion": another app of the suite (Alfred) opens
// /notes/reunion?titre=…&date=…&fin=…&lien=… and Cairn proposes the note.

export const MEETING_PATH = "/notes/reunion";
/** Cookie that keeps the meeting page across the sign-in, 10 minutes. */
export const RETURN_COOKIE = "cairn_retour";
export const RETURN_MAX_AGE = 600;

/** The cookie's value, as written by the middleware (encoded once), back to a path. */
export function readReturnCookie(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return safeReturn(decodeURIComponent(value));
  } catch {
    return null;
  }
}

/** The only addresses the sign-in may come back to: the meeting page, with its parameters. */
export function safeReturn(value: string | undefined | null): string | null {
  if (!value || value.length > 2000) return null;
  const path = value;
  if (!path.startsWith(MEETING_PATH)) return null;
  const rest = path.slice(MEETING_PATH.length);
  if (rest !== "" && !rest.startsWith("?")) return null;
  // Resolved against a fake origin: anything that leaves it, or has a backslash or control character, is refused.
  if (/[\\\u0000-\u001f]/.test(path)) return null;
  const url = new URL(path, "https://cairn.invalid");
  return url.origin === "https://cairn.invalid" && url.pathname === MEETING_PATH ? url.pathname + url.search : null;
}

export type Meeting = { title: string; when: string; link: SuiteLink & { href: string } | null };

const clip = (s: string | null, max: number) => (s ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);

/** "mardi 18 novembre 2026, 14:00 à 15:00", or the text as given when it is not a date. */
export function meetingWhen(date: string | null, end: string | null, timeZone?: string) {
  const start = clip(date, 80);
  if (!start) return "";
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return start;
  const hasTime = /T\d|\d:\d/.test(start);
  // Built in two parts: some ICU versions put a comma after the weekday ("jeudi, 19 novembre").
  const day = `${d.toLocaleDateString("fr-CH", { weekday: "long", timeZone })} ${d.toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric", timeZone })}`;
  if (!hasTime) return day;
  const time = (x: Date) => x.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit", timeZone });
  const e = end ? new Date(clip(end, 80)) : null;
  const sameDay = e && !Number.isNaN(e.getTime()) && e.toLocaleDateString("fr-CH", { timeZone }) === d.toLocaleDateString("fr-CH", { timeZone });
  return sameDay && e > d ? `${day}, ${time(d)} à ${time(e)}` : `${day}, ${time(d)}`;
}

/** The meeting described by the page's parameters. The link is kept only when it leads to an app of the suite. */
export function readMeeting(params: URLSearchParams, apps: SuiteApp[], timeZone?: string): Meeting {
  const title = clip(params.get("titre"), 200) || "Réunion";
  const href = clip(params.get("lien"), 1000);
  const match = href ? matchSuiteLink(href, apps) : null;
  return { title, when: meetingWhen(params.get("date"), params.get("fin"), timeZone), link: match ? { ...match, href: new URL(href).href } : null };
}

/** Markdown has no say in a title or a link: brackets and parentheses are escaped. */
const md = (s: string) => s.replace(/([\\`*_[\]()#<>!|])/g, "\\$1");

/** The note's Markdown. A link alone on its line shows as a card in Cairn. */
export function meetingMarkdown(m: Meeting) {
  const lines: string[] = [];
  if (m.link) lines.push(`[${md(m.title)}](${m.link.href.replace(/[()\s]/g, encodeURIComponent)})`, "");
  if (m.when) lines.push(`**Date** : ${md(m.when)}`, "");
  // Empty sections: an empty "- " or "- [ ]" shows as a stray bullet or "[]" in the preview.
  lines.push("## Participants", "", "", "## Ordre du jour", "", "", "## Notes", "", "", "## Actions", "", "");
  return lines.join("\n");
}
