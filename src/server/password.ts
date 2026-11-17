// The app password, changeable from the Settings page.
//
// Until it is changed, the password is APP_PASSWORD from the environment. Once changed, a scrypt hash
// lives in DATA_DIR/auth.json and wins over APP_PASSWORD. Deleting that file brings APP_PASSWORD back
// (the way out if the new password is forgotten).
//
// Read by the middleware too (Node runtime), so: no database here, only a small file.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { safeEqual, sessionToken } from "./auth";
import { twoFactorStamp } from "./two-factor-file";

type AuthFile = { salt: string; hash: string; sessionKey: string; changedAt: string };

const file = () => path.join(path.resolve(process.env.DATA_DIR ?? "./data"), "auth.json");

let cache: { mtime: number; data: AuthFile } | undefined;

/** Sessions can't match this key: used while auth.json exists but can't be read. */
const BROKEN_KEY = crypto.randomBytes(32).toString("hex");

/**
 * The password file. `null` only when the file does not exist (APP_PASSWORD applies).
 * A file that exists but can't be read or parsed is "broken": the last good content is kept if there
 * is one, otherwise nobody gets in. It must never open the app or bring the old password back.
 */
function readAuthFile(): AuthFile | null | "broken" {
  let mtime: number;
  try {
    mtime = fs.statSync(file()).mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      cache = undefined;
      return null;
    }
    console.error("[auth] auth.json illisible", e);
    return cache?.data ?? "broken";
  }
  if (cache?.mtime === mtime) return cache.data;
  try {
    const data = JSON.parse(fs.readFileSync(file(), "utf8")) as AuthFile;
    if (!(data.hash && data.salt && data.sessionKey)) throw new Error("incomplet");
    cache = { mtime, data };
    return data;
  } catch (e) {
    console.error("[auth] auth.json illisible", e);
    return cache?.data ?? "broken";
  }
}

// One hash at a time, off the event loop: a flood of login attempts must not stall the scheduler.
let hashing: Promise<unknown> = Promise.resolve();
function scrypt(password: string, salt: string): Promise<string> {
  const run = hashing.then(() => new Promise<string>((resolve, reject) => crypto.scrypt(password, salt, 32, (e, key) => (e ? reject(e) : resolve(key.toString("hex"))))));
  hashing = run.catch(() => {});
  return run;
}

/** Where the password comes from: changed in the app, APP_PASSWORD, or none (open app). */
export function passwordSource(): { source: "app" | "env" | "none"; changedAt?: string } {
  const f = readAuthFile();
  if (f === "broken") return { source: "app" };
  if (f) return { source: "app", changedAt: f.changedAt };
  return { source: process.env.APP_PASSWORD ? "env" : "none" };
}

export const passwordRequired = () => passwordSource().source !== "none";

export const MAX_PASSWORD = 200;

export async function checkPassword(given: unknown): Promise<boolean> {
  if (typeof given !== "string" || !given || given.length > MAX_PASSWORD) return false;
  const f = readAuthFile();
  if (f === "broken") return false;
  if (f) return safeEqual(await scrypt(given, f.salt), f.hash);
  const env = process.env.APP_PASSWORD;
  return !!env && safeEqual(given, env);
}

// The server's own session secret, 32 random bytes in DATA_DIR/session.key, created on first use.
// Every session token is signed with it, so a token can't be worked out from the password alone
// (with APP_PASSWORD, the token used to be a plain function of the password: anyone who knew the
// password, and roughly when two-factor was turned on, could make one without ever passing the code).
// Replacing the file logs every device out: that is "Déconnecter tous les appareils".
const sessionKeyFile = () => path.join(path.resolve(process.env.DATA_DIR ?? "./data"), "session.key");
let sessionKeyCache: { mtime: number; key: string } | undefined;

function writeSessionKey(flag: "wx" | "w") {
  fs.mkdirSync(path.dirname(sessionKeyFile()), { recursive: true });
  if (flag === "wx") {
    // "wx": never replace a key that appeared meanwhile (two requests at the first start).
    fs.writeFileSync(sessionKeyFile(), crypto.randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
    return;
  }
  const tmp = `${sessionKeyFile()}.tmp`;
  fs.writeFileSync(tmp, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  fs.renameSync(tmp, sessionKeyFile());
}

/** The session secret. `null` when it can't be read nor created: nobody gets in then. */
function sessionSecret(): string | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const mtime = fs.statSync(sessionKeyFile()).mtimeMs;
      if (sessionKeyCache?.mtime === mtime) return sessionKeyCache.key;
      const key = fs.readFileSync(sessionKeyFile(), "utf8").trim();
      if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("session.key invalide");
      sessionKeyCache = { mtime, key };
      return key;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" || attempt > 0) {
        console.error("[auth] session.key illisible", e);
        return null;
      }
      try {
        writeSessionKey("wx");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          console.error("[auth] session.key impossible à créer", err);
          return null;
        }
      }
    }
  }
  return null;
}

/** Logs every device out, this one included: the caller hands it a new cookie. */
export function rotateSessionSecret() {
  writeSessionKey("w");
  sessionKeyCache = undefined;
}

/** The session cookie value. Changing the password changes it, which logs every other device out. */
export async function currentSessionToken(): Promise<string | null> {
  const f = readAuthFile();
  const env = process.env.APP_PASSWORD;
  const base = f ? (f === "broken" ? BROKEN_KEY : f.sessionKey) : env;
  if (!base) return null;
  const secret = sessionSecret() ?? BROKEN_KEY;
  // Turning two-factor on or off changes the token too (see two-factor-file.ts).
  const stamp = twoFactorStamp();
  return sessionToken(secret, stamp ? `${base}\n2fa:${stamp}` : base);
}

export async function setPassword(next: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const data: AuthFile = { salt, hash: await scrypt(next, salt), sessionKey: crypto.randomBytes(32).toString("hex"), changedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  // Flushed to disk before it replaces the file: a crash must not leave an empty auth.json.
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file());
  cache = undefined;
}

export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
