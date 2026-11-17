import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPTE_MAX_AGE, comptePass, finishSignIn, mayEnter, settings, startSignIn, validComptePass } from "./compte";

const SECRET = "x".repeat(32);
const ENV = { COMPTE_URL: "https://compte.exemple.ch/", COMPTE_CLIENT_SECRET: SECRET, APP_URL: "https://cairn.exemple.ch" };
const ISSUER = "https://compte.exemple.ch/api/auth";
const NOW = Math.floor(Date.now() / 1000);

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

/** A fake account service: answers the discovery, then the token request with the given claims. */
function service(claims: Record<string, unknown> | null, meta: Record<string, unknown> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/.well-known/openid-configuration")) return json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth2/authorize`, token_endpoint: `${ISSUER}/oauth2/token`, ...meta });
    if (!claims) return json({ error: "access_denied" }, 403);
    return json({ id_token: `h.${b64(claims)}.s` });
  });
  return calls;
}

/** Starts a sign-in and returns what the browser would carry back. */
async function started() {
  const s = settings(ENV)!;
  const { url, cookie } = await startSignIn(undefined, s);
  const sent = new URL(url).searchParams;
  const pending = JSON.parse(Buffer.from(cookie, "base64url").toString()) as { state: string; nonce: string; verifier: string };
  const good = { iss: ISSUER, aud: "cairn", sub: "u-antoine", email: "antoine@exemple.ch", name: "Antoine", role: "admin", two_factor: true, nonce: pending.nonce, exp: NOW + 300, auth_time: NOW - 60 };
  return { s, sent, cookie, pending, good, back: `https://cairn.exemple.ch/api/auth/compte/callback?code=abc&state=${pending.state}` };
}

afterEach(() => vi.unstubAllGlobals());

describe("connexion par le Compte Postmelo", () => {
  it("reste éteinte sans adresse, sans vrai secret ou sans adresse de Cairn", () => {
    expect(settings({})).toBeNull();
    expect(settings({ ...ENV, COMPTE_CLIENT_SECRET: "court" })).toBeNull();
    expect(settings({ ...ENV, APP_URL: "" })).toBeNull();
    expect(settings({ ...ENV, COMPTE_URL: "compte.exemple.ch" })).toBeNull();
    expect(settings(ENV)).toEqual({ issuer: ISSUER, clientId: "cairn", clientSecret: SECRET, redirectUri: "https://cairn.exemple.ch/api/auth/compte/callback" });
  });

  it("refuse http en production", () => {
    expect(settings({ ...ENV, COMPTE_URL: "http://compte.exemple.ch", NODE_ENV: "production" })).toBeNull();
    expect(settings({ ...ENV, APP_URL: "http://cairn.exemple.ch", NODE_ENV: "production" })).toBeNull();
    expect(settings({ ...ENV, NODE_ENV: "production" })).not.toBeNull();
  });

  it("envoie vers le compte avec PKCE et demande une connexion récente", async () => {
    service(null);
    const { sent, pending } = await started();
    expect(sent.get("client_id")).toBe("cairn");
    expect(sent.get("redirect_uri")).toBe("https://cairn.exemple.ch/api/auth/compte/callback");
    expect(sent.get("code_challenge_method")).toBe("S256");
    expect(sent.get("max_age")).toBe(String(COMPTE_MAX_AGE));
    expect(sent.get("state")).toBe(pending.state);
    expect(sent.get("code_challenge")).not.toBe(pending.verifier);
  });

  it("n'envoie jamais le secret à une adresse hors du service", async () => {
    // Another address than the other tests: the discovery is remembered per service.
    const issuer = "https://compte2.exemple.ch/api/auth";
    service(null, { issuer, token_endpoint: "https://ailleurs.exemple.ch/token" });
    await expect(startSignIn(undefined, { ...settings(ENV)!, issuer })).rejects.toThrow(/hors de chez lui/);
  });

  it("rend la personne quand tout concorde", async () => {
    service(null);
    const { s, cookie, good, back, pending } = await started();
    const calls = service(good);
    const person = await finishSignIn(back, cookie, s);
    expect(person).toMatchObject({ id: "u-antoine", email: "antoine@exemple.ch", role: "admin", twoFactor: true });
    const token = calls.find((c) => c.url === `${ISSUER}/oauth2/token`)!;
    expect(String(token.init?.body)).toContain(`code_verifier=${pending.verifier}`);
  });

  it("refuse un retour que ce navigateur n'a pas commencé", async () => {
    service(null);
    const { s, cookie, good, back } = await started();
    service(good);
    await expect(finishSignIn(back, undefined, s)).rejects.toThrow(/expiré/);
    await expect(finishSignIn(back.replace(/state=.*/, "state=autre"), cookie, s)).rejects.toThrow(/expiré/);
  });

  it("refuse une identité faite pour un autre outil, un autre essai, ou périmée", async () => {
    service(null);
    const { s, cookie, good, back } = await started();
    for (const bad of [{ aud: "alfred" }, { iss: "https://ailleurs.exemple.ch/api/auth" }, { nonce: "autre" }, { exp: NOW - 3600 }, { sub: undefined }]) {
      service({ ...good, ...bad });
      await expect(finishSignIn(back, cookie, s)).rejects.toThrow(/invalide/);
    }
  });

  it("refuse une connexion au compte trop ancienne, ou sans date", async () => {
    service(null);
    const { s, cookie, good, back } = await started();
    service({ ...good, auth_time: NOW - COMPTE_MAX_AGE - 3600 });
    await expect(finishSignIn(back, cookie, s)).rejects.toThrow(/trop ancienne/);
    service({ ...good, auth_time: undefined });
    await expect(finishSignIn(back, cookie, s)).rejects.toThrow(/trop ancienne/);
  });

  it("refuse quand le compte refuse", async () => {
    service(null);
    const { s, cookie, back } = await started();
    await expect(finishSignIn(back, cookie, s)).rejects.toThrow(/pas ouvert/);
    await expect(finishSignIn(`${back}&error=access_denied`, cookie, s)).rejects.toThrow(/refusé/);
  });

  it("n'ouvre qu'aux administrateurs, sauf réglage contraire", () => {
    expect(mayEnter({ role: "admin" }, {})).toBe(true);
    expect(mayEnter({ role: "member" }, {})).toBe(false);
    expect(mayEnter({ role: "member" }, { COMPTE_MEMBERS: "true" })).toBe(true);
  });

  it("le laissez-passer après le compte vit cinq minutes et ne se fabrique pas sans le secret", () => {
    const now = 1_800_000_000_000;
    const pass = comptePass(SECRET, now);
    expect(validComptePass(SECRET, pass, now + 60_000)).toBe(true);
    expect(validComptePass(SECRET, pass, now + 301_000)).toBe(false);
    expect(validComptePass("y".repeat(32), pass, now)).toBe(false);
    const later = `${now + 9_000_000}.${pass.split(".")[1]}`;
    expect(validComptePass(SECRET, later, now)).toBe(false);
    for (const bad of [undefined, "", "abc", `${now}.`, "1.2.3"]) expect(validComptePass(SECRET, bad, now)).toBe(false);
  });
});
