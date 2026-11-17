// "Continuer avec mon Compte Postmelo" from the Mac and iPhone apps.
//
// The apps open the usual sign-in (src/server/compte.ts) in the system's sign-in sheet
// (ASWebAuthenticationSession). The session cookie set in that sheet would stay there, so instead:
//
//  1. The app makes a random verifier and opens /api/auth/compte/start?app=<SHA-256 of it>.
//  2. Back from the account service, the callback keeps the result under a one-time handoff code
//     (2 minutes, in memory) and sends the sheet to cairn://compte?code=<handoff>.
//  3. The app posts the handoff and its verifier to /api/auth/compte/app and gets the session cookie,
//     after Cairn's own two-factor code when the account has none (as on the web).
//
// The verifier never leaves the app before step 3: another app that grabbed the cairn:// link
// could not use it (the same idea as PKCE).
import crypto from "node:crypto";

export const APP_SCHEME = "cairn";
const HANDOFF_MAX_AGE = 120_000;
const MAX_TRIES = 5;

type Handoff = { challenge: string; needCode: boolean; expires: number; tries: number };
const handoffs = new Map<string, Handoff>();

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("base64url");

/** The `app` parameter of the start: a SHA-256 in base64url, nothing else. */
export const validChallenge = (value: string | null | undefined): value is string => !!value && /^[A-Za-z0-9_-]{43}$/.test(value);

/** Where the sign-in sheet goes at the end: back into the app. Only a keyword or the handoff, never a message. */
export const appReturn = (params: Record<string, string>) => `${APP_SCHEME}://compte?${new URLSearchParams(params)}`;

/** Step 2: keeps what the callback learnt, for the app holding the verifier. */
export function createHandoff(challenge: string, needCode: boolean, now = Date.now()) {
  for (const [key, h] of handoffs) if (h.expires < now) handoffs.delete(key);
  const handoff = crypto.randomBytes(32).toString("base64url");
  handoffs.set(handoff, { challenge, needCode, expires: now + HANDOFF_MAX_AGE, tries: 0 });
  return handoff;
}

export type Redeem = { ok: true } | { ok: false; error: string; needCode?: boolean; failure: boolean };

/**
 * Step 3. `checkCode` is Cairn's two-factor check. A wrong verifier ends the handoff;
 * a wrong code leaves it for a few more tries. `failure` counts toward the lock (throttle.ts).
 */
export function redeemHandoff(handoff: unknown, verifier: unknown, code: unknown, checkCode: (code: unknown) => boolean, now = Date.now()): Redeem {
  const expired: Redeem = { ok: false, error: "La connexion a expiré, recommence", failure: false };
  if (typeof handoff !== "string" || typeof verifier !== "string") return expired;
  const h = handoffs.get(handoff);
  if (!h || h.expires < now) {
    handoffs.delete(handoff);
    return expired;
  }
  const given = Buffer.from(sha256(verifier));
  const expected = Buffer.from(h.challenge);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    handoffs.delete(handoff);
    return { ...expired, failure: true };
  }
  if (h.needCode) {
    if (code === undefined || code === "") return { ok: false, error: "", needCode: true, failure: false };
    if (!checkCode(code)) {
      h.tries += 1;
      if (h.tries >= MAX_TRIES) handoffs.delete(handoff);
      return { ok: false, error: "Code incorrect ou déjà utilisé", needCode: h.tries < MAX_TRIES, failure: true };
    }
  }
  handoffs.delete(handoff);
  return { ok: true };
}

/** Reads the app challenge kept in the pending cookie, even when the sign-in itself failed. */
export function pendingApp(cookie: string | undefined): string | null {
  try {
    const app = (JSON.parse(Buffer.from(cookie ?? "", "base64url").toString()) as { app?: unknown }).app;
    return typeof app === "string" && validChallenge(app) ? app : null;
  } catch {
    return null;
  }
}

export function resetHandoffs() {
  handoffs.clear();
}
