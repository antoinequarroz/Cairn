// Brute force guard, shared by the login and by the settings that ask for the password or a code again.
//
// Per client: after 8 wrong answers from the same address, that address is refused for 15 minutes.
// Someone who hammers the login only locks themselves out, not Antoine on his own phone or Mac.
//
// Overall: past 50 wrong answers in 15 minutes from all addresses together (many machines guessing
// at once), the password login is closed to everyone for 15 minutes. What stays open then:
//  - "Continuer avec mon Compte Postmelo", and Cairn's code asked after it: the account has already
//    vouched for the person, a guesser can't get there;
//  - the settings that ask for the password again: whoever reaches them is already signed in.
//
// The address is the one the reverse proxy saw (the last entry of X-Forwarded-For, which Caddy
// writes itself). With nothing in front, or a proxy that hides addresses, every request looks the
// same: the guard then behaves like a single shared lock, never weaker.
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60_000;
const GLOBAL_MAX_FAILS = 50;
const MAX_CLIENTS = 10_000;

type Client = { fails: number; lockedUntil: number; lastAt: number };
const clients = new Map<string, Client>();
let globalFails = 0;
let globalWindowStart = 0;
let globalLockedUntil = 0;

/** An IPv6 address is reduced to its /64: one machine usually holds a whole /64 and could rotate within it. */
function normalize(ip: string): string {
  let a = ip.trim().toLowerCase();
  if (a.startsWith("[")) a = a.slice(1, a.indexOf("]") > 0 ? a.indexOf("]") : undefined);
  if (a.startsWith("::ffff:") && a.includes(".")) return a.slice(7);
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(a)) return a.replace(/:\d+$/, "");
  if (!a.includes(":")) return a || "inconnu";
  a = a.split("%")[0];
  const [head, tail] = a.split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Who is asking, as seen by the reverse proxy in front of Cairn. */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const last = forwarded?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return normalize(last ?? req.headers.get("x-real-ip") ?? "direct");
}

function prune(now: number) {
  if (clients.size < MAX_CLIENTS) return;
  for (const [key, c] of clients) if (c.lockedUntil < now && now - c.lastAt > LOCK_MS) clients.delete(key);
  // Still full (a flood of addresses): forget the oldest. The overall ceiling keeps counting them.
  while (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value as string);
}

/**
 * `global: true` for the password login only: it is also closed while the overall ceiling is reached.
 * Routes where the person is already vouched for (signed in, or back from the account) leave it out.
 */
export function isLocked(client: string, { global = false } = {}, now = Date.now()) {
  if (global && now < globalLockedUntil) return true;
  return now < (clients.get(client)?.lockedUntil ?? 0);
}

/** Counts a wrong answer, then waits a little: each guess costs time. */
export async function recordFailure(client: string, delayMs = 600, now = Date.now()) {
  prune(now);
  const c = clients.get(client) ?? { fails: 0, lockedUntil: 0, lastAt: now };
  // An old streak doesn't add up with a new one.
  if (now - c.lastAt > LOCK_MS) c.fails = 0;
  c.lastAt = now;
  if (++c.fails >= MAX_FAILS) {
    c.fails = 0;
    c.lockedUntil = now + LOCK_MS;
  }
  clients.delete(client);
  clients.set(client, c);

  if (now - globalWindowStart > LOCK_MS) {
    globalWindowStart = now;
    globalFails = 0;
  }
  if (++globalFails >= GLOBAL_MAX_FAILS) {
    globalFails = 0;
    globalWindowStart = now;
    globalLockedUntil = now + LOCK_MS;
    console.warn("[connexion] trop d'erreurs depuis plusieurs adresses : connexion par mot de passe fermée 15 minutes");
  }
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
}

/** A right answer clears that client's streak. The overall count runs on: it only fades with time. */
export function recordSuccess(client: string) {
  clients.delete(client);
}

export const LOCKED_MESSAGE = "Trop d'essais. Réessaie dans quelques minutes.";

/** For tests. */
export function resetThrottle() {
  clients.clear();
  globalFails = 0;
  globalWindowStart = 0;
  globalLockedUntil = 0;
}
