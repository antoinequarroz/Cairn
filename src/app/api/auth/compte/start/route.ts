import { appReturn, validChallenge } from "@/server/compte-app";
import { COMPTE_MAX_AGE, PENDING_COOKIE, PENDING_MAX_AGE, settings, startSignIn } from "@/server/compte";

export const dynamic = "force-dynamic";

const go = (location: string, cookie?: string) => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
};

/**
 * Step 1 of "Continuer avec mon Compte Postmelo": see src/server/compte.ts.
 * With `?app=<challenge>`, started from the Mac or iPhone app: see src/server/compte-app.ts.
 */
export async function GET(req: Request) {
  const app = new URL(req.url).searchParams.get("app");
  if (app !== null && !validChallenge(app)) return go(appReturn({ erreur: "refus" }));
  const fail = (keyword: string) => go(app ? appReturn({ erreur: keyword }) : `/login?compte=${keyword}`);
  if (!settings()) return app ? fail("off") : go("/login");
  try {
    const { url, cookie } = await startSignIn({ maxAge: COMPTE_MAX_AGE, ...(app ? { app } : {}) });
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return go(url, `${PENDING_COOKIE}=${cookie}; Path=/api/auth/compte; HttpOnly; SameSite=Lax; Max-Age=${PENDING_MAX_AGE}${secure}`);
  } catch (e) {
    console.error("[compte] service de compte injoignable", e);
    return fail("panne");
  }
}
