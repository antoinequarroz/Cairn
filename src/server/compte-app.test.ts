import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { appReturn, createHandoff, pendingApp, redeemHandoff, resetHandoffs, validChallenge } from "./compte-app";

const verifier = "v".repeat(43);
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const goodCode = (c: unknown) => c === "123456";

afterEach(() => resetHandoffs());

describe("Compte Postmelo depuis les apps", () => {
  it("n'accepte qu'une empreinte SHA-256 comme défi", () => {
    expect(validChallenge(challenge)).toBe(true);
    expect(validChallenge("court")).toBe(false);
    expect(validChallenge(`${challenge.slice(0, 42)}/`)).toBe(false);
    expect(validChallenge(null)).toBe(false);
  });

  it("renvoie vers l'app avec seulement un mot-clé ou le code de passage", () => {
    expect(appReturn({ erreur: "refus" })).toBe("cairn://compte?erreur=refus");
    expect(appReturn({ code: "abc" })).toBe("cairn://compte?code=abc");
  });

  it("donne la session une seule fois, à qui tient le vérificateur", () => {
    const handoff = createHandoff(challenge, false);
    expect(redeemHandoff(handoff, verifier, undefined, goodCode)).toEqual({ ok: true });
    expect(redeemHandoff(handoff, verifier, undefined, goodCode)).toMatchObject({ ok: false, failure: false });
  });

  it("refuse et efface le passage avec un autre vérificateur (lien cairn:// capté par une autre app)", () => {
    const handoff = createHandoff(challenge, false);
    expect(redeemHandoff(handoff, "w".repeat(43), undefined, goodCode)).toMatchObject({ ok: false, failure: true });
    expect(redeemHandoff(handoff, verifier, undefined, goodCode)).toMatchObject({ ok: false });
  });

  it("expire après deux minutes", () => {
    const now = Date.now();
    const handoff = createHandoff(challenge, false, now);
    expect(redeemHandoff(handoff, verifier, undefined, goodCode, now + 121_000)).toMatchObject({ ok: false, error: "La connexion a expiré, recommence" });
  });

  it("demande le code de Cairn quand le compte n'a pas de double authentification", () => {
    const handoff = createHandoff(challenge, true);
    expect(redeemHandoff(handoff, verifier, undefined, goodCode)).toMatchObject({ ok: false, needCode: true, failure: false });
    expect(redeemHandoff(handoff, verifier, "000000", goodCode)).toMatchObject({ ok: false, needCode: true, failure: true });
    expect(redeemHandoff(handoff, verifier, "123456", goodCode)).toEqual({ ok: true });
  });

  it("abandonne le passage après cinq mauvais codes", () => {
    const handoff = createHandoff(challenge, true);
    for (let i = 0; i < 4; i++) expect(redeemHandoff(handoff, verifier, "000000", goodCode)).toMatchObject({ needCode: true });
    expect(redeemHandoff(handoff, verifier, "000000", goodCode)).toMatchObject({ needCode: false });
    expect(redeemHandoff(handoff, verifier, "123456", goodCode)).toMatchObject({ ok: false, error: "La connexion a expiré, recommence" });
  });

  it("retrouve le défi de l'app dans le cookie de connexion en cours", () => {
    const cookie = Buffer.from(JSON.stringify({ state: "s", app: challenge })).toString("base64url");
    expect(pendingApp(cookie)).toBe(challenge);
    expect(pendingApp(Buffer.from(JSON.stringify({ state: "s" })).toString("base64url"))).toBeNull();
    expect(pendingApp("pas du json")).toBeNull();
    expect(pendingApp(undefined)).toBeNull();
  });
});
