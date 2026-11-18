import { NextResponse } from "next/server";
import { redeemHandoff } from "@/server/compte-app";
import { settings } from "@/server/compte";
import { setSessionCookie } from "@/server/cookie";
import { body } from "@/server/http";
import { clientKey, isLocked, LOCKED_MESSAGE, recordFailure, recordSuccess } from "@/server/throttle";
import { checkSecondFactor } from "@/server/two-factor";

export const dynamic = "force-dynamic";

/** Tells the Mac and iPhone apps whether to show "Continuer avec mon Compte Postmelo". */
export function GET() {
  return NextResponse.json({ enabled: !!settings() }, { headers: { "Cache-Control": "no-store" } });
}

/** Step 3 for the apps: the handoff and its verifier (and Cairn's code if asked) for the session cookie. See src/server/compte-app.ts. */
export async function POST(req: Request) {
  if (!settings()) return NextResponse.json({ error: "Connexion par compte non configurée" }, { status: 404 });
  const client = clientKey(req);
  if (isLocked(client)) return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 429 });
  const { handoff, verifier, code } = await body(req);
  const result = redeemHandoff(handoff, verifier, code, (c) => checkSecondFactor(c).ok);
  if (!result.ok) {
    if (result.failure) await recordFailure(client);
    return NextResponse.json(result.needCode ? { needCode: true, ...(result.error ? { error: result.error } : {}) } : { error: result.error }, { status: 401 });
  }
  recordSuccess(client);
  return setSessionCookie(NextResponse.json({ ok: true }));
}
