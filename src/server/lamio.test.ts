import { describe, expect, it } from "vitest";
import { lamioAuthorizeUrl, lamioConfig } from "./lamio";

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
});
