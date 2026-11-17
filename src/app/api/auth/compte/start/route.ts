import { PENDING_COOKIE, PENDING_MAX_AGE, settings, startSignIn } from "@/server/compte";

export const dynamic = "force-dynamic";

const go = (location: string, cookie?: string) => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
};

/** Step 1 of "Continuer avec mon Compte Postmelo": see src/server/compte.ts. */
export async function GET() {
  if (!settings()) return go("/login");
  try {
    const { url, cookie } = await startSignIn();
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return go(url, `${PENDING_COOKIE}=${cookie}; Path=/api/auth/compte; HttpOnly; SameSite=Lax; Max-Age=${PENDING_MAX_AGE}${secure}`);
  } catch (e) {
    console.error("[compte] service de compte injoignable", e);
    return go("/login?compte=panne");
  }
}
