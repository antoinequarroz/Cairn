import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hashRecoveryCode, hotp, newRecoveryCodes, newTotpSecret, otpauthUri, totpCode, verifyTotp } from "./totp";

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("base32 round trip, tolerant of spaces and case", () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv-gy3t qojq")).toEqual(Buffer.from("1234567890"));
    expect(base32Decode("not base32!")).toBeNull();
    expect(base32Decode("")).toBeNull();
  });

  it("matches the RFC 4226 and RFC 6238 test vectors", () => {
    const key = Buffer.from("12345678901234567890");
    expect([0, 1, 2, 9].map((c) => hotp(key, c))).toEqual(["755224", "287082", "359152", "520489"]);
    expect(totpCode(RFC_SECRET, 59_000, 8)).toBe("94287082");
    expect(totpCode(RFC_SECRET, 1111111109_000, 8)).toBe("07081804");
    expect(totpCode(RFC_SECRET, 2000000000_000, 8)).toBe("69279037");
    expect(totpCode(RFC_SECRET, 20000000000_000, 8)).toBe("65353130");
  });

  it("accepts one step of drift, refuses more, and never the same step twice", () => {
    const secret = newTotpSecret();
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now), now, step)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now, step)).toBe(step + 1);
    const spaced = totpCode(secret, now).replace(/(\d{3})/, "$1 ");
    expect(verifyTotp(secret, spaced, now)).toBe(step);
    for (const bad of ["", "12345", "1234567", "abcdef", 123456, null]) expect(verifyTotp(secret, bad, now)).toBeNull();
  });

  it("makes secrets of 160 bits and a link authenticator apps read", () => {
    const secret = newTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    const uri = new URL(otpauthUri(secret, "cairn.example.ch"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/Cairn:cairn.example.ch");
    expect(uri.searchParams.get("secret")).toBe(secret);
    expect(uri.searchParams.get("issuer")).toBe("Cairn");
  });

  it("recovery codes are distinct, and their hash ignores case and dashes", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(hashRecoveryCode(codes[0].toUpperCase().replace("-", " "))).toBe(hashRecoveryCode(codes[0]));
  });
});
