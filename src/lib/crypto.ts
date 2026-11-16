// Client-side encryption of the vault and of locked notes. Runs in the browser (and in tests):
// the server only ever stores what comes out of encrypt().
//
// master password --Argon2id--> key-encryption key --AES-GCM--> vault key --AES-GCM--> items, locked notes
//
// Changing the master password only re-wraps the vault key: items are not re-encrypted.
import { argon2id } from "hash-wasm";
import type { VaultMeta } from "./types";

const KDF = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 };

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const aes = (raw: Uint8Array, extractable = false) => crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", extractable, ["encrypt", "decrypt"]);

async function deriveKek(password: string, kdf: VaultMeta["kdf"]) {
  const raw = await argon2id({
    password: password.normalize("NFKC"),
    salt: unb64(kdf.salt),
    memorySize: kdf.memoryKiB,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
    hashLength: 32,
    outputType: "binary",
  });
  return aes(raw);
}

async function seal(key: CryptoKey, plain: Uint8Array) {
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource));
  return `v1.${b64(iv)}.${b64(ct)}`;
}

async function open(key: CryptoKey, blob: string) {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Format chiffré inconnu");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) as BufferSource }, key, unb64(ct) as BufferSource));
}

/** Creates a vault: a random vault key, wrapped by the master password. */
export async function createVault(password: string, kdfOverride?: Partial<typeof KDF>): Promise<{ meta: VaultMeta; key: CryptoKey }> {
  const kdf: VaultMeta["kdf"] = { name: "argon2id", salt: b64(random(16)), ...KDF, ...kdfOverride };
  const rawKey = random(32);
  const wrappedKey = await seal(await deriveKek(password, kdf), rawKey);
  return { meta: { v: 1, kdf, wrappedKey }, key: await aes(rawKey) };
}

/** Opens the vault. Throws when the master password is wrong. */
export async function unlockVault(password: string, meta: VaultMeta): Promise<CryptoKey> {
  const kek = await deriveKek(password, meta.kdf);
  let raw: Uint8Array;
  try {
    raw = await open(kek, meta.wrappedKey);
  } catch {
    throw new Error("Mot de passe maître incorrect");
  }
  return aes(raw);
}

export const encryptText = (key: CryptoKey, text: string) => seal(key, new TextEncoder().encode(text));
export const decryptText = async (key: CryptoKey, blob: string) => new TextDecoder().decode(await open(key, blob));
export const encryptJson = (key: CryptoKey, value: unknown) => encryptText(key, JSON.stringify(value));
export const decryptJson = async <T>(key: CryptoKey, blob: string) => JSON.parse(await decryptText(key, blob)) as T;

/** Random password from an unambiguous alphabet (no 0/O, 1/l/I). */
export function generatePassword(length = 24) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_+=?";
  const out: string[] = [];
  // Rejection sampling: no modulo bias.
  const limit = 256 - (256 % alphabet.length);
  while (out.length < length) for (const b of random(length * 2)) if (b < limit && out.length < length) out.push(alphabet[b % alphabet.length]);
  return out.join("");
}
