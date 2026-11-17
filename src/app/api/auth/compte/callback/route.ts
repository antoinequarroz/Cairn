import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";
import { COMPTE_OK_COOKIE, COMPTE_OK_MAX_AGE, comptePass, finishSignIn, mayEnter, PENDING_COOKIE, settings } from "@/server/compte";
import { currentSessionToken, SESSION_MAX_AGE } from "@/server/password";
import { isLocked } from "@/server/throttle";
import { twoFactorRequired } from "@/server/two-factor";

export const dynamic = "force-dynamic";

const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");
const clearPending = () => `${PENDING_COOKIE}=; Path=/api/auth/compte; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;

// Relative addresses stay on this app whatever sits in front of it.
function go(location: string, cookie?: string) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearPending());
  if (cookie) headers.append("Set-Cookie", `${cookie}; HttpOnly; SameSite=Lax${secure()}`);
  return new Response(null, { status: 302, headers });
}

/** Steps 2 and 3 of "Continuer avec mon Compte Postmelo": see src/server/compte.ts. */
export async function GET(req: Request) {
  const config = settings();
  if (!config) return go("/login");
  if (isLocked()) return go("/login?compte=refus");
  let person;
  try {
    // The pending cookie proves this browser started the sign-in: a link forged elsewhere has no matching one.
    person = await finishSignIn(req.url, (await cookies()).get(PENDING_COOKIE)?.value, config);
  } catch (e) {
    console.warn(`[compte] connexion refusée : ${(e as Error).message}`);
    return go("/login?compte=refus");
  }
  if (!mayEnter(person)) {
    console.warn(`[compte] ${person.email} n'est pas administrateur : refusé`);
    return go("/login?compte=acces");
  }
  console.log(`[compte] connexion de ${person.email}`);
  // The account stands in for the password. For the second factor, either the account has its own, or Cairn asks its code next.
  if (twoFactorRequired() && !person.twoFactor) return go("/login?compte=code", `${COMPTE_OK_COOKIE}=${comptePass(config.clientSecret)}; Path=/api/auth/login; Max-Age=${COMPTE_OK_MAX_AGE}`);
  const session = await currentSessionToken();
  return go("/", session ? `${SESSION_COOKIE}=${session}; Path=/; Max-Age=${SESSION_MAX_AGE}` : undefined);
}
