// The two-factor state, in DATA_DIR/two-factor.json. Read by the middleware too (through the session
// token), so: plain files only here, no database and no "server-only" import. The TOTP secret inside is
// sealed by secret-box.ts; this module never opens it.
//
// Deleting the file turns two-factor off (the way out with neither the phone nor a recovery code):
//   docker compose exec cairn rm /data/two-factor.json
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type TwoFactorFile = {
  /** The TOTP secret, sealed (secret-box). */
  secret: string;
  enabledAt: string;
  /** Last time step accepted: a code can't be used twice. */
  lastStep: number;
  /** SHA-256 of the recovery codes not used yet. */
  recovery: string[];
};

const file = () => path.join(path.resolve(process.env.DATA_DIR ?? "./data"), "two-factor.json");

let cache: { mtime: number; data: TwoFactorFile } | undefined;

/**
 * `null` only when the file does not exist (two-factor off). A file that exists but can't be read is
 * "broken": the last good content if there is one, otherwise nobody gets in. A damaged file must never
 * switch two-factor off by itself.
 */
export function readTwoFactor(): TwoFactorFile | null | "broken" {
  let mtime: number;
  try {
    mtime = fs.statSync(file()).mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      cache = undefined;
      return null;
    }
    console.error("[2fa] two-factor.json illisible", e);
    return cache?.data ?? "broken";
  }
  if (cache?.mtime === mtime) return cache.data;
  try {
    const data = JSON.parse(fs.readFileSync(file(), "utf8")) as TwoFactorFile;
    if (!(data.secret && data.enabledAt && Array.isArray(data.recovery) && typeof data.lastStep === "number")) throw new Error("incomplet");
    cache = { mtime, data };
    return data;
  } catch (e) {
    console.error("[2fa] two-factor.json illisible", e);
    return cache?.data ?? "broken";
  }
}

/** Sessions can't match this: used while two-factor.json exists but can't be read. */
const BROKEN_STAMP = crypto.randomBytes(16).toString("hex");

/**
 * Mixed into the session token. Turning two-factor on or off changes it, which logs out every device
 * that came in without it (the current one gets a new cookie). `""` when off: tokens stay as they were.
 */
export function twoFactorStamp(): string {
  const f = readTwoFactor();
  if (f === "broken") return BROKEN_STAMP;
  return f ? f.enabledAt : "";
}

export function writeTwoFactor(data: TwoFactorFile | null) {
  if (data === null) {
    fs.rmSync(file(), { force: true });
    cache = undefined;
    return;
  }
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  // Flushed before it replaces the file: a crash must not leave an empty two-factor.json.
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
