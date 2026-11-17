import { safeEqual, SESSION_COOKIE } from "./auth";
import { currentSessionToken } from "./password";

/**
 * Who may come in. Everything is private once a password is set (APP_PASSWORD, or the one changed
 * in Réglages). Scripts (Hermes, Claude Code) can use "Authorization: Bearer <API_TOKEN>" on /api
 * routes, except the vault (only ever opened in a browser, with the master password) and the
 * settings (the app password and the AI keys are managed from a browser session only).
 */
export async function checkAccess(pathname: string, authorization: string | null, cookie: string | undefined, request?: RequestSite): Promise<"ok" | "denied" | "unconfigured"> {
  const expected = await currentSessionToken();
  if (!expected) {
    // No password in production would publish every note: refuse instead.
    return process.env.NODE_ENV === "production" && process.env.ALLOW_NO_PASSWORD !== "true" ? "unconfigured" : "ok";
  }
  const apiToken = process.env.API_TOKEN;
  const bearer = authorization?.replace(/^Bearer\s+/i, "");
  if (apiToken && bearer && pathname.startsWith("/api/") && !pathname.startsWith("/api/vault") && !pathname.startsWith("/api/settings") && safeEqual(bearer, apiToken)) return "ok";
  if (request && crossSite(request)) return "denied";
  return cookie && safeEqual(cookie, expected) ? "ok" : "denied";
}

/** What a request says about the page that sent it. */
export type RequestSite = { method: string; secFetchSite: string | null; origin: string | null; host: string | null };

export const requestSite = (req: { method: string; headers: Headers }): RequestSite => ({
  method: req.method,
  secFetchSite: req.headers.get("sec-fetch-site"),
  origin: req.headers.get("origin"),
  host: req.headers.get("x-forwarded-host")?.split(",")[0].trim() ?? req.headers.get("host"),
});

/**
 * A change sent by another site, with this browser's cookie (CSRF). SameSite=Lax is not enough here:
 * the other apps of the suite (*.postmelo.ch) are the "same site" for the browser, so a page on any of
 * them could post to Cairn with the session. Browsers say where a request comes from (Sec-Fetch-Site,
 * else Origin); the apps and scripts send neither, and are let through.
 */
export function crossSite({ method, secFetchSite, origin, host }: RequestSite) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (secFetchSite) return secFetchSite !== "same-origin" && secFetchSite !== "none";
  if (!origin) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** For the few routes the middleware does not cover. */
export async function authorized(req: Request) {
  const cookie = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return (await checkAccess(new URL(req.url).pathname, req.headers.get("authorization"), cookie, requestSite(req))) === "ok";
}
