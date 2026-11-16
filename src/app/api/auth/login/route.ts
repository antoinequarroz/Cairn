import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";
import { checkPassword, currentSessionToken, passwordRequired, SESSION_MAX_AGE } from "@/server/password";

// Brute force guard: after 8 wrong passwords, logins are refused for 15 minutes.
// Global rather than per address: behind the proxy every client can look the same, and there is one user.
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60_000;
let fails = 0;
let lockedUntil = 0;

export async function POST(req: Request) {
  const { password: given } = (await req.json().catch(() => ({}))) as { password?: unknown };
  if (!passwordRequired()) return NextResponse.json({ ok: true });
  if (Date.now() < lockedUntil) return NextResponse.json({ error: "Trop d'essais. Réessaie dans quelques minutes." }, { status: 429 });
  if (!(await checkPassword(given))) {
    if (++fails >= MAX_FAILS) {
      fails = 0;
      lockedUntil = Date.now() + LOCK_MS;
    }
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }
  fails = 0;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, (await currentSessionToken())!, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
