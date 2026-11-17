import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "cairn-session-"));
});

import { POST as rotate } from "@/app/api/settings/sessions/route";
import { currentSessionToken } from "./password";
import { checkAccess, crossSite } from "./session";
import { resetThrottle } from "./throttle";

const DIR = process.env.DATA_DIR!;
const PASSWORD = "un mot de passe assez long";

const post = (json: unknown) =>
  rotate(new Request("http://cairn.test/api/settings/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) }));

beforeEach(() => {
  vi.stubEnv("APP_PASSWORD", PASSWORD);
  vi.spyOn(console, "error").mockImplementation(() => {});
  resetThrottle();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("session token", () => {
  it("can't be worked out from the password alone", async () => {
    const token = await currentSessionToken();
    const fromPassword = (msg: string) => crypto.createHmac("sha256", PASSWORD).update(msg).digest("hex");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toBe(fromPassword("cairn-session-v1"));
    expect(token).not.toBe(fromPassword(`cairn-session-v2\n${PASSWORD}`));
    // Signed with a random secret kept by the server, readable by the app only.
    const stat = fs.statSync(path.join(DIR, "session.key"));
    expect(stat.mode & 0o077).toBe(0);
  });

  it("stays the same from one request to the next", async () => {
    expect(await currentSessionToken()).toBe(await currentSessionToken());
  });

  it("changes with the password", async () => {
    const before = await currentSessionToken();
    vi.stubEnv("APP_PASSWORD", "un autre mot de passe");
    expect(await currentSessionToken()).not.toBe(before);
  });
});

describe("déconnecter les autres appareils", () => {
  it("asks for the password", async () => {
    const before = await currentSessionToken();
    const res = await post({ password: "faux" });
    expect(res.status).toBe(403);
    expect(await currentSessionToken()).toBe(before);
  });

  it("makes every old cookie useless and gives this browser a new one", async () => {
    const before = (await currentSessionToken())!;
    expect(await checkAccess("/api/notes", null, before)).toBe("ok");
    const res = await post({ password: PASSWORD });
    expect(res.status).toBe(200);
    const after = (await currentSessionToken())!;
    expect(after).not.toBe(before);
    expect(res.headers.get("set-cookie")).toContain(`cairn_session=${after}`);
    expect(await checkAccess("/api/notes", null, before)).toBe("denied");
    expect(await checkAccess("/api/notes", null, after)).toBe("ok");
  });
});

describe("requests from another site (CSRF)", () => {
  const site = (method: string, secFetchSite: string | null, origin: string | null = null) => ({ method, secFetchSite, origin, host: "cairn.postmelo.ch" });

  it("refuses a change posted by another app of the suite with the cookie", async () => {
    const token = (await currentSessionToken())!;
    expect(crossSite(site("POST", "same-site", "https://lamio.postmelo.ch"))).toBe(true);
    expect(crossSite(site("POST", "cross-site", "https://evil.example"))).toBe(true);
    expect(await checkAccess("/api/notes", null, token, site("POST", "same-site", "https://lamio.postmelo.ch"))).toBe("denied");
  });

  it("checks the Origin when the browser sends no Sec-Fetch-Site", () => {
    expect(crossSite(site("POST", null, "https://lamio.postmelo.ch"))).toBe(true);
    expect(crossSite(site("POST", null, "https://cairn.postmelo.ch"))).toBe(false);
    expect(crossSite(site("DELETE", null, "null"))).toBe(true);
  });

  it("lets Cairn's own pages, the apps and scripts through", async () => {
    const token = (await currentSessionToken())!;
    expect(await checkAccess("/api/notes", null, token, site("POST", "same-origin", "https://cairn.postmelo.ch"))).toBe("ok");
    // Mac and iPhone apps, curl: neither header.
    expect(await checkAccess("/api/notes", null, token, site("PATCH", null))).toBe("ok");
    // Reading is never refused for this: a link from another site still opens a note.
    expect(crossSite(site("GET", "cross-site", null))).toBe(false);
  });
});
