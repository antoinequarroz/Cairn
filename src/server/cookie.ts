import type { NextResponse } from "next/server";
import { SESSION_COOKIE } from "./auth";
import { currentSessionToken, SESSION_MAX_AGE } from "./password";

/** Gives this browser the current session cookie (after a login, or a change that logged the others out). */
export async function setSessionCookie(res: NextResponse) {
  const token = await currentSessionToken();
  if (token) res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_MAX_AGE });
  return res;
}
