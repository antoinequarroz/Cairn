import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cairn-2fa-"));
});

import { POST as login } from "@/app/api/auth/login/route";
import { POST as settings } from "@/app/api/settings/two-factor/route";
import { currentSessionToken } from "./password";
import { resetThrottle } from "./throttle";
import { totpCode } from "./totp";
import { checkSecondFactor, disableTwoFactor, enableTwoFactor, twoFactorRequired, twoFactorStatus } from "./two-factor";

const DIR = process.env.DATA_DIR!;
const FILE = path.join(DIR, "two-factor.json");
const PASSWORD = "un mot de passe assez long";
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const post = (handler: (req: Request) => Promise<Response>, json: unknown) =>
  handler(new Request("http://cairn.test/api", { method: "POST", headers: { "Content-Type": "application/json", host: "cairn.test" }, body: JSON.stringify(json) }));

beforeEach(() => {
  vi.stubEnv("APP_PASSWORD", PASSWORD);
  vi.stubEnv("CAIRN_SECRET", "secret de test");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_800_000_000_000);
  disableTwoFactor();
  resetThrottle();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("two-factor storage", () => {
  it("keeps the secret sealed, refuses a reused code, and uses a recovery code once", () => {
    const codes = enableTwoFactor(SECRET, 0);
    const raw = fs.readFileSync(FILE, "utf8");
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(codes[0]);
    expect(fs.statSync(FILE).mode & 0o777).toBe(0o600);

    const code = totpCode(SECRET, Date.now());
    expect(checkSecondFactor(code)).toEqual({ ok: true });
    expect(checkSecondFactor(code)).toEqual({ ok: false });

    expect(checkSecondFactor(codes[3].toUpperCase())).toEqual({ ok: true, usedRecovery: true });
    expect(checkSecondFactor(codes[3])).toEqual({ ok: false });
    expect(twoFactorStatus().recoveryLeft).toBe(7);
  });

  it("only recovery codes work once the server key changed", () => {
    const codes = enableTwoFactor(SECRET, 0);
    vi.stubEnv("CAIRN_SECRET", "une autre clé");
    expect(checkSecondFactor(totpCode(SECRET, Date.now())).ok).toBe(false);
    expect(checkSecondFactor(codes[0]).ok).toBe(true);
  });

  it("a damaged file keeps two-factor on and lets nobody in", async () => {
    const before = await currentSessionToken();
    fs.writeFileSync(FILE, "{pas du json");
    expect(twoFactorRequired()).toBe(true);
    expect(twoFactorStatus()).toMatchObject({ enabled: true, broken: true });
    expect(checkSecondFactor("123456").ok).toBe(false);
    expect(await currentSessionToken()).not.toBe(before);
  });

  it("turning it on or off changes the session token; off gives back the old one", async () => {
    const off = await currentSessionToken();
    enableTwoFactor(SECRET, 0);
    expect(await currentSessionToken()).not.toBe(off);
    disableTwoFactor();
    expect(await currentSessionToken()).toBe(off);
  });
});

describe("login with two-factor", () => {
  it("asks for a code after the right password, then signs in", async () => {
    enableTwoFactor(SECRET, 0);
    const wrong = await post(login, { password: "faux" });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).not.toHaveProperty("needCode");

    const step1 = await post(login, { password: PASSWORD });
    expect(step1.status).toBe(401);
    expect(await step1.json()).toEqual({ needCode: true });
    expect(step1.headers.get("set-cookie")).toBeNull();

    const bad = await post(login, { password: PASSWORD, code: "000000" });
    expect(bad.status).toBe(401);

    const ok = await post(login, { password: PASSWORD, code: totpCode(SECRET, Date.now()) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain(`cairn_session=${await currentSessionToken()}`);
  }, 20_000);

  it("a code without the right password does nothing", async () => {
    enableTwoFactor(SECRET, 0);
    const res = await post(login, { password: "faux", code: totpCode(SECRET, Date.now()) });
    expect(res.status).toBe(401);
    // The code was not spent by that attempt.
    expect(checkSecondFactor(totpCode(SECRET, Date.now())).ok).toBe(true);
  });

  it("wrong codes count toward the lock", async () => {
    enableTwoFactor(SECRET, 0);
    vi.useRealTimers();
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
    for (let i = 0; i < 8; i++) await post(login, { password: PASSWORD, code: "000000" });
    const locked = await post(login, { password: PASSWORD, code: totpCode(SECRET, Date.now()) });
    expect(locked.status).toBe(429);
  });

  it("someone else locked out by their guesses doesn't lock out another address", async () => {
    vi.useRealTimers();
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
    const from = (ip: string, json: unknown) =>
      login(new Request("http://cairn.test/api", { method: "POST", headers: { "Content-Type": "application/json", host: "cairn.test", "x-forwarded-for": ip }, body: JSON.stringify(json) }));
    for (let i = 0; i < 8; i++) await from("203.0.113.66", { password: "faux" });
    expect((await from("203.0.113.66", { password: PASSWORD })).status).toBe(429);
    expect((await from("198.51.100.10", { password: PASSWORD })).status).toBe(200);
  });
});

describe("Réglages > Sécurité", () => {
  it("setup, then enable with password and code, then disable", async () => {
    const setup = (await (await post(settings, { action: "setup" })).json()) as { secret: string; qr: string; uri: string };
    expect(setup.qr).toContain("<svg");
    expect(setup.uri).toContain("Cairn%3Acairn.test");
    expect(twoFactorRequired()).toBe(false);

    const noPassword = await post(settings, { action: "enable", secret: setup.secret, code: totpCode(setup.secret, Date.now()), password: "faux" });
    expect(noPassword.status).toBe(403);

    const enabled = await post(settings, { action: "enable", secret: setup.secret, code: totpCode(setup.secret, Date.now()), password: PASSWORD });
    expect(enabled.status).toBe(200);
    expect(((await enabled.json()) as { recoveryCodes: string[] }).recoveryCodes).toHaveLength(8);
    expect(enabled.headers.get("set-cookie")).toContain(`cairn_session=${await currentSessionToken()}`);
    expect(twoFactorRequired()).toBe(true);

    // The code that enabled it can't be replayed.
    const replay = await post(settings, { action: "disable", code: totpCode(setup.secret, Date.now()), password: PASSWORD });
    expect(replay.status).toBe(403);
    vi.setSystemTime(Date.now() + 30_000);
    const disabled = await post(settings, { action: "disable", code: totpCode(setup.secret, Date.now()), password: PASSWORD });
    expect(disabled.status).toBe(200);
    expect(twoFactorRequired()).toBe(false);
  }, 20_000);
});
