// Two-factor sign-in: a code from an authenticator app (TOTP) after the password, or a recovery code.
import "server-only";
import { open, seal } from "./secret-box";
import { hashRecoveryCode, newRecoveryCodes, verifyTotp } from "./totp";
import { readTwoFactor, writeTwoFactor } from "./two-factor-file";

export type TwoFactorStatus = { enabled: boolean; enabledAt?: string; recoveryLeft?: number; broken?: boolean };

export function twoFactorStatus(): TwoFactorStatus {
  const f = readTwoFactor();
  if (f === "broken") return { enabled: true, broken: true };
  if (!f) return { enabled: false };
  return { enabled: true, enabledAt: f.enabledAt, recoveryLeft: f.recovery.length };
}

export const twoFactorRequired = () => readTwoFactor() !== null;

/** Turns two-factor on with a secret the user has just proved they scanned. Returns the recovery codes, shown once. */
export function enableTwoFactor(secret: string, confirmedStep: number): string[] {
  const codes = newRecoveryCodes();
  writeTwoFactor({ secret: seal(secret), enabledAt: new Date().toISOString(), lastStep: confirmedStep, recovery: codes.map(hashRecoveryCode) });
  return codes;
}

export function disableTwoFactor() {
  writeTwoFactor(null);
}

/** New recovery codes; the old ones stop working. */
export function renewRecoveryCodes(): string[] | null {
  const f = readTwoFactor();
  if (!f || f === "broken") return null;
  const codes = newRecoveryCodes();
  writeTwoFactor({ ...f, recovery: codes.map(hashRecoveryCode) });
  return codes;
}

/**
 * Checks a code from the app, or a recovery code (which is then used up). `false` when two-factor is
 * on but its secret can't be opened (CAIRN_SECRET changed, secret.key lost): only a recovery code works then.
 */
export function checkSecondFactor(code: unknown, nowMs = Date.now()): { ok: boolean; usedRecovery?: boolean } {
  const f = readTwoFactor();
  if (!f || f === "broken" || typeof code !== "string" || code.length > 40) return { ok: false };
  const secret = open(f.secret);
  if (secret) {
    const step = verifyTotp(secret, code, nowMs, f.lastStep);
    if (step !== null) {
      writeTwoFactor({ ...f, lastStep: step });
      return { ok: true };
    }
  }
  const hash = hashRecoveryCode(code);
  if (f.recovery.includes(hash)) {
    writeTwoFactor({ ...f, recovery: f.recovery.filter((h) => h !== hash) });
    return { ok: true, usedRecovery: true };
  }
  return { ok: false };
}
