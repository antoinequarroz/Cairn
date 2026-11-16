import { describe, expect, it } from "vitest";
import { createVault, decryptJson, decryptText, encryptJson, encryptText, generatePassword, unlockVault } from "./crypto";

// Light Argon2 settings: the real ones take about a second per derivation.
const fast = { memoryKiB: 1024, iterations: 1 };

describe("coffre", () => {
  it("chiffre puis déchiffre avec le bon mot de passe", async () => {
    const { meta, key } = await createVault("correct horse battery staple", fast);
    const blob = await encryptJson(key, { type: "ssh", name: "vps", privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----" });
    expect(blob).not.toContain("OPENSSH");

    const again = await unlockVault("correct horse battery staple", meta);
    expect(await decryptJson(again, blob)).toMatchObject({ name: "vps", type: "ssh" });
  });

  it("refuse un mauvais mot de passe", async () => {
    const { meta } = await createVault("un bon mot de passe", fast);
    await expect(unlockVault("un mauvais", meta)).rejects.toThrow("incorrect");
  });

  it("détecte un contenu modifié", async () => {
    const { key } = await createVault("x", fast);
    const blob = await encryptText(key, "secret");
    const [v, iv, ct] = blob.split(".");
    const tampered = `${v}.${iv}.${ct.slice(0, -4)}AAAA`;
    await expect(decryptText(key, tampered)).rejects.toThrow();
  });

  it("ne produit jamais deux fois le même chiffré", async () => {
    const { key } = await createVault("x", fast);
    expect(await encryptText(key, "a")).not.toBe(await encryptText(key, "a"));
  });

  it("génère des mots de passe de la bonne longueur", () => {
    expect(generatePassword(32)).toHaveLength(32);
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
