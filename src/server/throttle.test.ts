import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientKey, isLocked, recordFailure, recordSuccess, resetThrottle } from "./throttle";

const req = (headers: Record<string, string>) => new Request("http://cairn.test/api/auth/login", { headers });
const T = 1_800_000_000_000;

async function fail(client: string, times: number, now = T) {
  for (let i = 0; i < times; i++) await recordFailure(client, 0, now);
}

beforeEach(() => {
  resetThrottle();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("clientKey", () => {
  it("takes the address written by the proxy, the last one, not one the client sent ahead", () => {
    expect(clientKey(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("falls back to X-Real-IP, then to one shared key", () => {
    expect(clientKey(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientKey(req({}))).toBe("direct");
  });

  it("groups an IPv6 address by its /64, and unwraps IPv4 in IPv6", () => {
    const a = clientKey(req({ "x-forwarded-for": "2001:db8:abcd:12:1::1" }));
    const b = clientKey(req({ "x-forwarded-for": "2001:db8:abcd:12:ffff:ffff:ffff:fffe" }));
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(b).toBe(a);
    expect(clientKey(req({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8:0:0::/64");
    expect(clientKey(req({ "x-forwarded-for": "::ffff:192.0.2.1" }))).toBe("192.0.2.1");
  });
});

describe("lock per address", () => {
  it("8 wrong answers lock that address only", async () => {
    await fail("1.1.1.1", 7, T);
    expect(isLocked("1.1.1.1", {}, T)).toBe(false);
    await fail("1.1.1.1", 1, T);
    expect(isLocked("1.1.1.1", {}, T)).toBe(true);
    expect(isLocked("1.1.1.1", { global: true }, T)).toBe(true);
    // Antoine, from elsewhere, can still sign in.
    expect(isLocked("2.2.2.2", { global: true }, T)).toBe(false);
  });

  it("the lock lasts 15 minutes", async () => {
    await fail("1.1.1.1", 8, T);
    expect(isLocked("1.1.1.1", {}, T + 14 * 60_000)).toBe(true);
    expect(isLocked("1.1.1.1", {}, T + 15 * 60_000 + 1)).toBe(false);
  });

  it("a right answer clears the streak, and an old streak is forgotten", async () => {
    await fail("1.1.1.1", 7, T);
    recordSuccess("1.1.1.1");
    await fail("1.1.1.1", 7, T);
    expect(isLocked("1.1.1.1", {}, T)).toBe(false);
    await fail("1.1.1.1", 7, T + 16 * 60_000);
    expect(isLocked("1.1.1.1", {}, T + 16 * 60_000)).toBe(false);
  });
});

describe("overall ceiling", () => {
  it("many addresses guessing together close the password login, not the other doors", async () => {
    for (let i = 0; i < 50; i++) await recordFailure(`10.0.0.${i}`, 0, T);
    // The password login (global: true) is closed for everyone…
    expect(isLocked("192.0.2.50", { global: true }, T)).toBe(true);
    // …but the account sign-in and the settings (signed in already) still work from a clean address.
    expect(isLocked("192.0.2.50", {}, T)).toBe(false);
    expect(isLocked("192.0.2.50", { global: true }, T + 15 * 60_000 + 1)).toBe(false);
  });

  it("failures spread over more than 15 minutes don't add up", async () => {
    for (let i = 0; i < 40; i++) await recordFailure(`10.0.0.${i}`, 0, T);
    for (let i = 0; i < 40; i++) await recordFailure(`10.0.1.${i}`, 0, T + 16 * 60_000);
    expect(isLocked("192.0.2.50", { global: true }, T + 16 * 60_000)).toBe(false);
  });
});
