import { NextResponse } from "next/server";
import { setSessionCookie } from "@/server/cookie";
import { body } from "@/server/http";
import { checkPassword, passwordRequired } from "@/server/password";
import { isLocked, LOCKED_MESSAGE, recordFailure, recordSuccess } from "@/server/throttle";
import { checkSecondFactor, twoFactorRequired } from "@/server/two-factor";

export const dynamic = "force-dynamic";

/**
 * Password, then (when two-factor is on) a code from the authenticator app or a recovery code.
 * The page sends the password again with the code: nothing is half signed in on the server.
 * Wrong passwords and wrong codes count together toward the lock (see throttle.ts).
 */
export async function POST(req: Request) {
  const { password: given, code } = await body(req);
  if (!passwordRequired()) return NextResponse.json({ ok: true });
  if (isLocked()) return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 429 });
  if (!(await checkPassword(given))) {
    await recordFailure();
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }
  let usedRecovery = false;
  if (twoFactorRequired()) {
    if (code === undefined || code === "") return NextResponse.json({ needCode: true }, { status: 401 });
    const check = checkSecondFactor(code);
    if (!check.ok) {
      await recordFailure();
      return NextResponse.json({ error: "Code incorrect ou déjà utilisé", needCode: true }, { status: 401 });
    }
    usedRecovery = !!check.usedRecovery;
  }
  recordSuccess();
  return setSessionCookie(NextResponse.json({ ok: true, usedRecovery }));
}
