// Encryption at rest for the secrets the server itself must be able to use: the AI keys and tokens
// entered in Réglages. The vault is different (end-to-end, the server can't read it).
//
// The key is CAIRN_SECRET when it is set (best: it then lives outside the data volume and its backups),
// otherwise 32 random bytes kept in DATA_DIR/secret.key, created on first use, readable by the app only.
// The backup script leaves secret.key out: a stolen backup holds the database but not the key to these
// secrets. The flip side: after restoring a backup on a new server, the AI keys must be entered again.
import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VERSION = "s1";

let cached: { source: string; key: Buffer } | undefined;

const keyFile = () => path.join(path.resolve(process.env.DATA_DIR ?? "./data"), "secret.key");

function readOrCreateKeyFile(): Buffer {
  const file = keyFile();
  try {
    return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    // "wx": never replace a key that appeared meanwhile, it would make every secret unreadable.
    fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}

function key(): Buffer {
  const env = process.env.CAIRN_SECRET?.trim();
  const source = env ? `env:${env}` : `file:${keyFile()}`;
  if (cached?.source === source) return cached.key;
  const k = env ? Buffer.from(crypto.hkdfSync("sha256", env, "cairn", "cairn-secret-box-v1", 32)) : readOrCreateKeyFile();
  if (k.length !== 32) throw new Error("secret.key invalide");
  cached = { source, key: k };
  return k;
}

/** AES-256-GCM. The result is `s1.<iv>.<ciphertext+tag>`, base64url. */
export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const out = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${iv.toString("base64url")}.${out.toString("base64url")}`;
}

/** `null` when the blob can't be opened: another key (CAIRN_SECRET changed, secret.key lost) or tampered. */
export function open(sealed: string): string | null {
  const [version, iv, data] = sealed.split(".");
  if (version !== VERSION || !iv || !data) return null;
  try {
    const buf = Buffer.from(data, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([decipher.update(buf.subarray(0, buf.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
