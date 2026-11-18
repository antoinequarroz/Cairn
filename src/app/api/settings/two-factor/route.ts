import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { setSessionCookie } from "@/server/cookie";
import { body, fail } from "@/server/http";
import { checkPassword, passwordRequired } from "@/server/password";
import { clientKey, isLocked, LOCKED_MESSAGE, recordFailure, recordSuccess } from "@/server/throttle";
import { newTotpSecret, otpauthUri, verifyTotp } from "@/server/totp";
import { checkSecondFactor, disableTwoFactor, enableTwoFactor, renewRecoveryCodes, twoFactorStatus } from "@/server/two-factor";

// Réglages > Sécurité. Browser session only: the middleware refuses API_TOKEN on /api/settings.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(twoFactorStatus());
}

/**
 * - setup: a new secret and its QR code. Nothing is saved yet.
 * - enable: password + the secret + a code from the app proving it was scanned. Returns the recovery codes.
 * - disable / recovery: password + a code (or a recovery code).
 * Wrong answers count toward the same lock as the login. 403, not 401: a 401 sends the page to the login.
 */
export async function POST(req: Request) {
  const { action, password, code, secret } = await body(req);

  if (action === "setup") {
    if (twoFactorStatus().enabled) return fail("La double authentification est déjà active");
    if (!passwordRequired()) return fail("Choisis d'abord un mot de passe pour l'app");
    const fresh = newTotpSecret();
    // The account name shown in the app: the address Cairn is reached at.
    const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "cairn").split(",")[0].trim().replace(/:\d+$/, "");
    const uri = otpauthUri(fresh, host);
    const qr = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return NextResponse.json({ secret: fresh, uri, qr });
  }

  if (action !== "enable" && action !== "disable" && action !== "recovery") return fail("Action inconnue");
  const client = clientKey(req);
  if (isLocked(client)) return fail(LOCKED_MESSAGE, 429);
  if (passwordRequired() && !(await checkPassword(password))) {
    await recordFailure(client);
    return fail("Mot de passe incorrect", 403);
  }

  if (action === "enable") {
    if (twoFactorStatus().enabled) return fail("La double authentification est déjà active");
    if (typeof secret !== "string" || secret.length > 64) return fail("Secret invalide");
    const step = verifyTotp(secret, code, Date.now());
    if (step === null) {
      await recordFailure(client);
      return fail("Code incorrect. Vérifie l'heure du téléphone et réessaie avec le code suivant.", 403);
    }
    recordSuccess(client);
    const recoveryCodes = enableTwoFactor(secret, step);
    return setSessionCookie(NextResponse.json({ ok: true, recoveryCodes }));
  }

  if (!twoFactorStatus().enabled) return fail("La double authentification n'est pas active");
  if (!checkSecondFactor(code).ok) {
    await recordFailure(client);
    return fail("Code incorrect ou déjà utilisé", 403);
  }
  recordSuccess(client);
  if (action === "recovery") return NextResponse.json({ ok: true, recoveryCodes: renewRecoveryCodes() });
  disableTwoFactor();
  return setSessionCookie(NextResponse.json({ ok: true }));
}
