import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { setSessionCookie } from "@/server/cookie";
import { body } from "@/server/http";
import { COMPTE_OK_COOKIE, settings, validComptePass } from "@/server/compte";
import { checkPassword, passwordRequired } from "@/server/password";
import { clientKey, isLocked, LOCKED_MESSAGE, recordFailure, recordSuccess } from "@/server/throttle";
import { checkSecondFactor, twoFactorRequired } from "@/server/two-factor";

export const dynamic = "force-dynamic";

/**
 * Password, then (when two-factor is on) a code from the authenticator app or a recovery code.
 * The page sends the password again with the code: nothing is half signed in on the server.
 * Wrong passwords and wrong codes count together toward the lock of this address (see throttle.ts).
 *
 * Coming back from "Continuer avec mon Compte Postmelo" with two-factor on here and none on the
 * account, the browser holds a short-lived pass in place of the password (see compte.ts): only the code is sent.
 */
export async function POST(req: Request) {
  const { password: given, code } = await body(req);
  if (!passwordRequired()) return NextResponse.json({ ok: true });
  const client = clientKey(req);
  const compte = settings();
  const viaCompte = given === undefined && !!compte && validComptePass(compte.clientSecret, (await cookies()).get(COMPTE_OK_COOKIE)?.value);
  // Back from the account, the overall ceiling doesn't apply: the account has vouched for the person (see throttle.ts).
  if (isLocked(client, { global: !viaCompte })) return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 429 });
  if (!viaCompte && !(await checkPassword(given))) {
    await recordFailure(client);
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }
  let usedRecovery = false;
  if (twoFactorRequired()) {
    if (code === undefined || code === "") return NextResponse.json({ needCode: true }, { status: 401 });
    const check = checkSecondFactor(code);
    if (!check.ok) {
      await recordFailure(client);
      return NextResponse.json({ error: "Code incorrect ou déjà utilisé", needCode: true }, { status: 401 });
    }
    usedRecovery = !!check.usedRecovery;
  }
  recordSuccess(client);
  const res = NextResponse.json({ ok: true, usedRecovery });
  if (viaCompte) res.cookies.set(COMPTE_OK_COOKIE, "", { path: "/api/auth/login", maxAge: 0 });
  return setSessionCookie(res);
}
