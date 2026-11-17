// Time-based one-time passwords (RFC 6238), as shown by any authenticator app:
// HMAC-SHA1, 6 digits, a new code every 30 seconds. Pure functions, no storage here.
import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** `null` when the text is not base32. Spaces, dashes and lower case are accepted (copied by hand). */
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 20 random bytes (160 bits, the size RFC 4226 recommends), in base32. */
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(key: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return bin.toString().padStart(digits, "0");
}

export const timeStep = (nowMs: number) => Math.floor(nowMs / 1000 / STEP_SECONDS);

export function totpCode(secret: string, nowMs: number, digits = DIGITS): string {
  const key = base32Decode(secret);
  if (!key) throw new Error("Secret TOTP invalide");
  return hotp(key, timeStep(nowMs), digits);
}

/**
 * The time step the code belongs to, or `null`. One step of drift either way is accepted (a phone clock
 * a little off, a code typed as it changes). A step at or before `afterStep` is refused: a code seen
 * once (over a shoulder, in a proxy log) can't be used again.
 */
export function verifyTotp(secret: string, code: unknown, nowMs: number, afterStep = -1): number | null {
  if (typeof code !== "string") return null;
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const key = base32Decode(secret);
  if (!key) return null;
  const now = timeStep(nowMs);
  let match: number | null = null;
  // Every candidate is computed and compared in constant time: the timing says nothing about which one matched.
  for (const step of [now - 1, now, now + 1]) {
    const ok = crypto.timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(given));
    if (ok && step > afterStep && match === null) match = step;
  }
  return match;
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUri(secret: string, account: string, issuer = "Cairn") {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

// Recovery codes: for a lost phone. 10 characters from an alphabet without look-alikes (50 bits each),
// shown once, kept only as SHA-256 hashes (enough for random codes of that length), used once.
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    let code = "";
    for (let i = 0; i < 10; i++) code += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");

export const hashRecoveryCode = (code: string) => crypto.createHash("sha256").update(`cairn-recovery-v1:${normalizeRecoveryCode(code)}`).digest("hex");
