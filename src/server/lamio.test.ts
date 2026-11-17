import { describe, expect, it } from "vitest";
import { lamioAuthorizeUrl, lamioConfig, lamioPass, validLamioPass } from "./lamio";

const SECRET = "x".repeat(32);

describe("connexion avec Lamio", () => {
  it("reste éteinte sans adresse ou sans vrai secret", () => {
    expect(lamioConfig({})).toBeNull();
    expect(lamioConfig({ LAMIO_URL: "https://lamio.exemple.ch" })).toBeNull();
    expect(lamioConfig({ LAMIO_URL: "https://lamio.exemple.ch", LAMIO_SSO_SECRET: "court" })).toBeNull();
    expect(lamioConfig({ LAMIO_URL: "lamio.exemple.ch", LAMIO_SSO_SECRET: SECRET })).toBeNull();
  });

  it("envoie vers Lamio, au nom de cet outil", () => {
    const config = lamioConfig({ LAMIO_URL: "https://lamio.exemple.ch/", LAMIO_SSO_SECRET: SECRET })!;
    expect(config).toMatchObject({ url: "https://lamio.exemple.ch", client: "cairn" });
    expect(lamioAuthorizeUrl(config, "abc")).toBe("https://lamio.exemple.ch/sso/authorize?client=cairn&state=abc");
  });

  it("le laissez-passer après Lamio vit cinq minutes et ne se fabrique pas sans le secret", () => {
    const now = 1_800_000_000_000;
    const pass = lamioPass(SECRET, now);
    expect(validLamioPass(SECRET, pass, now + 60_000)).toBe(true);
    expect(validLamioPass(SECRET, pass, now + 301_000)).toBe(false);
    expect(validLamioPass("y".repeat(32), pass, now)).toBe(false);
    const later = `${now + 9_000_000}.${pass.split(".")[1]}`;
    expect(validLamioPass(SECRET, later, now)).toBe(false);
    for (const bad of [undefined, "", "abc", `${now}.`, "1.2.3"]) expect(validLamioPass(SECRET, bad, now)).toBe(false);
  });
});
