import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./server/auth";
import { checkAccess } from "./server/session";

// Everything is private once a password is set (APP_PASSWORD, or the one changed in Réglages).
// Scripts (Hermes, Claude Code) can use "Authorization: Bearer <API_TOKEN>" on /api routes,
// except the vault: its content is only ever opened in a browser, with the master password.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const access = await checkAccess(pathname, req.headers.get("authorization"), req.cookies.get(SESSION_COOKIE)?.value);
  if (access === "unconfigured") return new NextResponse("Cairn : définis APP_PASSWORD avant de mettre en ligne.", { status: 503 });
  if (access === "ok") return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Node runtime: the password changed in Réglages is read from a file in DATA_DIR.
  runtime: "nodejs",
  // File chunks (api/uploads) are left out: the middleware would hold their body. That route checks the session itself.
  matcher: ["/((?!login|api/auth/login|api/auth/lamio|api/uploads/|_next/static|_next/image|icon.svg|favicon.ico|manifest.webmanifest).*)"],
};
