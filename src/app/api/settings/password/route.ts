import { NextResponse } from "next/server";
import { setSessionCookie } from "@/server/cookie";
import { body, fail } from "@/server/http";
import { checkPassword, MAX_PASSWORD, passwordRequired, passwordSource, setPassword } from "@/server/password";
import { isLocked, LOCKED_MESSAGE, recordFailure, recordSuccess } from "@/server/throttle";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(passwordSource());
}

/** Changes the app password. Every other device is logged out. */
export async function POST(req: Request) {
  const { current, next } = await body(req);
  if (typeof next !== "string" || next.length < 10 || next.length > MAX_PASSWORD) return fail("Le nouveau mot de passe doit faire au moins 10 caractères");
  if (isLocked()) return fail(LOCKED_MESSAGE, 429);
  // 403, not 401: a 401 sends the page back to the login.
  if (passwordRequired() && !(await checkPassword(current))) {
    await recordFailure();
    return fail("Mot de passe actuel incorrect", 403);
  }
  recordSuccess();
  await setPassword(next);
  return setSessionCookie(NextResponse.json({ ok: true }));
}
