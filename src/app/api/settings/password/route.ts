import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";
import { checkPassword, currentSessionToken, MAX_PASSWORD, passwordRequired, passwordSource, SESSION_MAX_AGE, setPassword } from "@/server/password";
import { body, fail } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(passwordSource());
}

/** Changes the app password. Every other device is logged out. */
export async function POST(req: Request) {
  const { current, next } = await body(req);
  if (typeof next !== "string" || next.length < 10 || next.length > MAX_PASSWORD) return fail("Le nouveau mot de passe doit faire au moins 10 caractères");
  if (passwordRequired() && !(await checkPassword(current))) {
    await new Promise((r) => setTimeout(r, 600));
    return fail("Mot de passe actuel incorrect", 401);
  }
  await setPassword(next);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, (await currentSessionToken())!, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE });
  return res;
}
