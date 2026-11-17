// "Continuer avec mon Compte Postmelo": the suite's account service vouches for the person.
// Standard OpenID Connect ("authorization code" with PKCE), no dependency. Adapted from
// clients/compte.ts of github.com/antoinequarroz/postmelo-compte.
//
//  1. /api/auth/compte/start sends the browser to the account service, with a random state, nonce
//     and PKCE verifier kept in a short-lived cookie.
//  2. The service checks the person is signed in and may open Cairn, then sends the browser back
//     to /api/auth/compte/callback with a code that works once.
//  3. This server trades the code for the person, with the secret shared with the service. The
//     secret never goes through the browser.
//
// Off unless COMPTE_URL, COMPTE_CLIENT_SECRET and APP_URL are all set. The password keeps working
// either way: it is the way in when the account service is down.
//
// Cairn holds keys, so it is stricter than the other tools:
//  - only administrators of the account service come in, unless COMPTE_MEMBERS=true (Cairn has one
//    space: whoever comes in reads every note);
//  - the person must have proved who they are to the service in the last COMPTE_MAX_AGE seconds;
//  - the account stands in for the password, not for the second factor: when two-factor is on here
//    and the account has none, Cairn's own code is still asked (COMPTE_OK_COOKIE below).
// The vault stays closed until the master password is typed, whoever signs in.
import nodeCrypto from "node:crypto";

export const START_PATH = "/api/auth/compte/start";
export const CALLBACK_PATH = "/api/auth/compte/callback";
/** Cookie that carries the pending sign-in between start and callback: httpOnly, SameSite=Lax, 10 minutes. */
export const PENDING_COOKIE = "compte_pending";
export const PENDING_MAX_AGE = 600;
/** How recently the person must have signed in to the account service: 12 hours. */
export const COMPTE_MAX_AGE = 12 * 3600;

export type Person = {
  /** Stable id of the person, the same in every tool. */
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  /** The account is protected by a second factor. */
  twoFactor: boolean;
  /** When the person last proved who they are, in seconds since 1970. */
  authTime: number;
};

type Settings = { issuer: string; clientId: string; clientSecret: string; redirectUri: string };
type Endpoints = { authorization_endpoint: string; token_endpoint: string; issuer: string };

const trim = (value: string | undefined) => (value ?? "").trim().replace(/\/+$/, "");

/** Null when the variables are missing: Cairn then keeps its password only. */
export function settings(env: Record<string, string | undefined> = process.env): Settings | null {
  const url = trim(env.COMPTE_URL);
  const clientId = (env.COMPTE_CLIENT_ID ?? "").trim() || "cairn";
  const clientSecret = (env.COMPTE_CLIENT_SECRET ?? "").trim();
  const app = trim(env.APP_URL);
  // In production the secret and the identity only travel over TLS.
  const web = env.NODE_ENV === "production" ? /^https:\/\// : /^https?:\/\//;
  if (!web.test(url) || !web.test(app) || clientSecret.length < 32) return null;
  return { issuer: `${url}/api/auth`, clientId, clientSecret, redirectUri: app + CALLBACK_PATH };
}

let discovered: { issuer: string; endpoints: Promise<Endpoints> } | null = null;

function endpoints(s: Settings): Promise<Endpoints> {
  if (discovered?.issuer !== s.issuer) {
    const endpoints = fetch(`${s.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) }).then(async (res) => {
      if (!res.ok) throw new Error(`Service de compte injoignable (${res.status})`);
      const meta = (await res.json()) as Endpoints;
      if (meta.issuer !== s.issuer) throw new Error("Le service de compte ne répond pas sous l'adresse attendue");
      // The secret is only ever sent to the service itself.
      const origin = new URL(s.issuer).origin;
      if (new URL(meta.token_endpoint).origin !== origin || new URL(meta.authorization_endpoint).origin !== origin) throw new Error("Le service de compte annonce des adresses hors de chez lui");
      return meta;
    });
    // A failed discovery is not kept: the next sign-in tries again.
    endpoints.catch(() => (discovered = null));
    discovered = { issuer: s.issuer, endpoints };
  }
  return discovered.endpoints;
}

const random = (bytes = 32) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
const sha256 = async (value: string) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64url");

/**
 * Step 1. Returns the address to send the browser to, and the value of the pending cookie.
 * `maxAge` (seconds) asks for a recent sign-in: older sessions must type their password again.
 */
export async function startSignIn(options: { maxAge?: number; next?: string; app?: string } = { maxAge: COMPTE_MAX_AGE }, s = settings()) {
  if (!s) throw new Error("Connexion par compte non configurée");
  const meta = await endpoints(s);
  // `app`: started from the Mac or iPhone app (see compte-app.ts).
  const pending = { state: random(), nonce: random(), verifier: random(48), next: options.next ?? "", ...(options.app ? { app: options.app } : {}) };
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: s.clientId,
    redirect_uri: s.redirectUri,
    scope: "openid profile email",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: await sha256(pending.verifier),
    code_challenge_method: "S256",
    ...(options.maxAge !== undefined ? { max_age: String(options.maxAge) } : {}),
  }).toString();
  return { url: url.href, cookie: Buffer.from(JSON.stringify(pending)).toString("base64url") };
}

/**
 * Step 2. Trades the code of the callback for the person. Throws when anything is off:
 * the tool then shows its sign-in page again with the message.
 */
export async function finishSignIn(callbackUrl: string, cookie: string | undefined, s = settings(), maxAge = COMPTE_MAX_AGE): Promise<Person & { next: string }> {
  if (!s) throw new Error("Connexion par compte non configurée");
  const params = new URL(callbackUrl).searchParams;
  let pending: { state: string; nonce: string; verifier: string; next: string };
  try {
    pending = JSON.parse(Buffer.from(cookie ?? "", "base64url").toString());
  } catch {
    throw new Error("La connexion a expiré, recommence");
  }
  if (!pending?.state || params.get("state") !== pending.state) throw new Error("La connexion a expiré, recommence");
  if (params.get("iss") && params.get("iss") !== s.issuer) throw new Error("Réponse d'un autre service");
  if (params.get("error")) throw new Error(params.get("error") === "access_denied" ? "Accès refusé" : "La connexion a échoué");
  const code = params.get("code");
  if (!code) throw new Error("La connexion a échoué");

  const meta = await endpoints(s);
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(s.clientId)}:${encodeURIComponent(s.clientSecret)}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: s.redirectUri, code_verifier: pending.verifier }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(res.status === 403 ? "Cet outil n'est pas ouvert à ton compte" : "La connexion a échoué");
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("La connexion a échoué");

  // The ID token comes straight from the service, over TLS, in answer to our secret:
  // OpenID Connect (Core §3.1.3.7) then lets the client trust it without checking its signature.
  const claims = JSON.parse(Buffer.from(id_token.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== s.issuer || !audience.includes(s.clientId) || claims.nonce !== pending.nonce || typeof claims.exp !== "number" || claims.exp < now - 60) throw new Error("Réponse du service de compte invalide");
  if (typeof claims.sub !== "string" || typeof claims.email !== "string") throw new Error("Réponse du service de compte invalide");
  // Asked with max_age at step 1, and checked again here: an old session of the account is not enough.
  if (typeof claims.auth_time !== "number" || claims.auth_time < now - maxAge - 60) throw new Error("Connexion au compte trop ancienne");

  return {
    id: claims.sub,
    name: typeof claims.name === "string" ? claims.name : claims.email,
    email: claims.email,
    role: claims.role === "admin" ? "admin" : "member",
    twoFactor: claims.two_factor === true,
    authTime: claims.auth_time,
    // Only a path of this tool, never another site.
    next: /^\/(?![/\\])/.test(pending.next) ? pending.next : "/",
  };
}

/** Cairn has one space: by default only the administrators of the account service come in. */
export function mayEnter(person: Pick<Person, "role">, env: Record<string, string | undefined> = process.env) {
  return person.role === "admin" || env.COMPTE_MEMBERS === "true";
}

export const COMPTE_OK_COOKIE = "compte_ok";
export const COMPTE_OK_MAX_AGE = 300;

const sign = (secret: string, expires: number) => nodeCrypto.createHmac("sha256", secret).update(`compte-ok:${expires}`).digest("hex");

/** "The account vouched for this browser", good for a few minutes: what is left to give is Cairn's two-factor code. */
export function comptePass(secret: string, now = Date.now()) {
  const expires = now + COMPTE_OK_MAX_AGE * 1000;
  return `${expires}.${sign(secret, expires)}`;
}

export function validComptePass(secret: string, value: string | undefined, now = Date.now()) {
  const [expires, mac] = (value ?? "").split(".");
  if (!/^\d{13}$/.test(expires ?? "") || !mac || Number(expires) < now) return false;
  const expected = sign(secret, Number(expires));
  return mac.length === expected.length && nodeCrypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}
