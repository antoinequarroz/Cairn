import { NextResponse } from "next/server";
import { setSessionCookie } from "@/server/cookie";
import { body, fail } from "@/server/http";
import { checkPassword, passwordRequired, rotateSessionSecret } from "@/server/password";
import { isLocked, LOCKED_MESSAGE, recordFailure, recordSuccess } from "@/server/throttle";

export const dynamic = "force-dynamic";

/**
 * Réglages > Sécurité > "Déconnecter les autres appareils": a new session secret, so every cookie
 * handed out so far stops working (a lost phone, a forgotten browser). This browser gets a new one.
 * Asks for the password again, like every setting that guards the door.
 */
export async function POST(req: Request) {
  const { password } = await body(req);
  if (isLocked()) return fail(LOCKED_MESSAGE, 429);
  // 403, not 401: a 401 sends the page back to the login.
  if (passwordRequired() && !(await checkPassword(password))) {
    await recordFailure();
    return fail("Mot de passe incorrect", 403);
  }
  recordSuccess();
  rotateSessionSecret();
  return setSessionCookie(NextResponse.json({ ok: true }));
}
