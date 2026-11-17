// Shared by middleware (edge) and route handlers: Web Crypto only.

export const SESSION_COOKIE = "cairn_session";

async function hmac(secret: string, message: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Session token: signed with the server's random session secret (DATA_DIR/session.key), over what the
 * password and two-factor state are. Changing the password, two-factor, or the secret logs everyone out.
 * The password alone is not enough to make one.
 */
export function sessionToken(secret: string, state: string) {
  return hmac(secret, `cairn-session-v2\n${state}`);
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

