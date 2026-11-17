import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createVault, encryptJson } from "./crypto";
import type { VaultItemData } from "./types";
import { itemFingerprint, itemsToCsv, openCairnExport, parseCsv, readImportFile, type CairnExport, type ParsedImport } from "./vault-import";

const read = (name: string, text: string) => readImportFile(name, strToU8(text)) as ParsedImport;
const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----";

describe("CSV", () => {
  it("lit les guillemets, les virgules et les retours à la ligne dans une cellule", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","ligne 1\nligne ""2"""\r\n\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'ligne 1\nligne "2"'],
    ]);
  });

  it("refuse un CSV sans colonnes connues", () => {
    expect(() => read("x.csv", "foo,bar\n1,2\n")).toThrow("Colonnes non reconnues");
  });
});

describe("1Password", () => {
  it("lit un .1pux : identifiants, clé SSH, carte, archivés et documents", () => {
    const data = {
      accounts: [
        {
          vaults: [
            {
              attrs: { name: "Personnel" },
              items: [
                {
                  state: "active",
                  categoryUuid: "001",
                  overview: { title: "GitHub", url: "https://github.com", urls: [{ url: "https://github.com" }, { url: "https://gist.github.com" }], tags: ["dev"] },
                  details: {
                    loginFields: [
                      { designation: "username", value: "antoine", fieldType: "T" },
                      { designation: "password", value: "s3cret!", fieldType: "P" },
                    ],
                    notesPlain: "Compte principal",
                    sections: [{ title: "", fields: [{ title: "one-time password", id: "TOTP_x", value: { totp: "otpauth://totp/GitHub?secret=ABC" } }] }],
                  },
                },
                {
                  state: "active",
                  categoryUuid: "114",
                  overview: { title: "VPS Infomaniak" },
                  details: { sections: [{ fields: [{ title: "private key", id: "private_key", value: { sshKey: { privateKey: KEY, metadata: { publicKey: "ssh-ed25519 AAAA antoine" } } } }] }] },
                },
                {
                  state: "active",
                  categoryUuid: "002",
                  overview: { title: "Visa" },
                  details: { sections: [{ fields: [{ title: "numéro", id: "ccnum", value: { creditCardNumber: "4111111111111111" } }, { title: "expiration", value: { monthYear: 202812 } }] }] },
                },
                { state: "archived", categoryUuid: "001", overview: { title: "Vieux compte" }, details: {} },
                { state: "active", categoryUuid: "006", overview: { title: "Scan passeport" }, details: {} },
              ],
            },
          ],
        },
      ],
    };
    const zip = zipSync({ "export.attributes": strToU8("{}"), "export.data": strToU8(JSON.stringify(data)), "files/abc.pdf": new Uint8Array(10) });
    const r = readImportFile("1PasswordExport.1pux", zip) as ParsedImport;
    expect(r.source).toBe("1password");
    expect(r.items).toHaveLength(3);
    const [gh, vps, visa] = r.items;
    expect(gh).toMatchObject({ type: "login", name: "GitHub", url: "https://github.com", username: "antoine", password: "s3cret!" });
    expect(gh.notes).toContain("Compte principal");
    expect(gh.notes).toContain("Code 2FA (TOTP) : otpauth://totp/GitHub?secret=ABC");
    expect(gh.notes).toContain("Autre adresse : https://gist.github.com");
    expect(gh.notes).toContain("Étiquettes : dev");
    expect(vps).toEqual({ type: "ssh", name: "VPS Infomaniak", privateKey: KEY, publicKey: "ssh-ed25519 AAAA antoine" });
    expect(visa.type).toBe("secret");
    expect(visa.notes).toContain("Type : Carte bancaire");
    expect(visa.notes).toContain("numéro : 4111111111111111");
    expect(visa.notes).toContain("expiration : 12/2028");
    expect(r.skipped).toEqual(["Vieux compte (archivé)", "Scan passeport (document joint, à récupérer à part)"]);
  });

  it("lit l'export CSV de 1Password 8", () => {
    const r = read("1Password.csv", 'Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\nGmail,https://mail.google.com,a@b.ch,pw1,otpauth://totp/x,false,false,,\n"Codes secours",,,,,false,false,,"1234\n5678"\n');
    expect(r.source).toBe("1password");
    expect(r.items).toEqual([
      { type: "login", name: "Gmail", url: "https://mail.google.com", username: "a@b.ch", password: "pw1", notes: "Code 2FA (TOTP) : otpauth://totp/x" },
      { type: "secret", name: "Codes secours", notes: "1234\n5678" },
    ]);
  });
});

describe("Bitwarden", () => {
  it("lit un export JSON non chiffré, clé SSH comprise", () => {
    const json = {
      encrypted: false,
      folders: [{ id: "f1", name: "Serveurs" }],
      items: [
        { type: 1, name: "Hetzner", folderId: "f1", notes: null, fields: [{ name: "Compte", value: "K123", type: 0 }], login: { username: "root", password: "pw", totp: null, uris: [{ uri: "https://console.hetzner.cloud" }] } },
        { type: 2, name: "Note", notes: "contenu", secureNote: { type: 0 } },
        { type: 5, name: "Clé VPS", notes: null, sshKey: { privateKey: KEY, publicKey: "ssh-ed25519 BBBB", keyFingerprint: "SHA256:xyz" } },
        { type: 3, name: "Carte", card: { cardholderName: "A Q", number: "4111", code: "123" } },
      ],
    };
    const r = read("bitwarden_export.json", JSON.stringify(json));
    expect(r.source).toBe("bitwarden");
    expect(r.items[0]).toEqual({ type: "login", name: "Hetzner", url: "https://console.hetzner.cloud", username: "root", password: "pw", notes: "Compte : K123\nDossier : Serveurs" });
    expect(r.items[1]).toEqual({ type: "secret", name: "Note", notes: "contenu" });
    expect(r.items[2]).toEqual({ type: "ssh", name: "Clé VPS", privateKey: KEY, publicKey: "ssh-ed25519 BBBB", notes: "Empreinte : SHA256:xyz" });
    expect(r.items[3].notes).toContain("Numéro : 4111");
  });

  it("refuse un export chiffré avec une explication", () => {
    expect(() => read("b.json", '{"encrypted":true,"passwordProtected":true,"data":"x"}')).toThrow("non chiffré");
  });

  it("lit l'export CSV", () => {
    const csv = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nPerso,,login,Infomaniak,,"PIN: 1234",0,"https://manager.infomaniak.com,https://kchat.infomaniak.com",antoine,pw,\n,,note,Clé,"' + KEY + '\nserveur: vps",,0,,,,\n';
    const r = read("bitwarden.csv", csv);
    expect(r.source).toBe("bitwarden");
    expect(r.items[0]).toEqual({ type: "login", name: "Infomaniak", url: "https://manager.infomaniak.com", username: "antoine", password: "pw", notes: "Autre adresse : https://kchat.infomaniak.com\nPIN : 1234\nDossier : Perso" });
    // A secure note holding a private key becomes an SSH key.
    expect(r.items[1]).toEqual({ type: "ssh", name: "Clé", privateKey: KEY, notes: "serveur: vps" });
  });
});

describe("NordPass", () => {
  it("lit l'export CSV : identifiants, notes, cartes, dossiers ignorés", () => {
    const header = "name,url,additional_urls,username,password,note,cardholdername,cardnumber,cvc,pin,expirydate,zipcode,folder,full_name,phone_number,email,address1,address2,city,country,state,type,custom_fields";
    const rows = [
      'Swisscom,https://www.swisscom.ch,"[""https://login.swisscom.ch""]",antoine,pw,,,,,,,,Maison,,,,,,,,,password,"[{""label"":""Client"",""type"":""text"",""value"":""42""}]"',
      "Wifi,,,,,mot de passe wifi,,,,,,,,,,,,,,,,note,",
      "Maison,,,,,,,,,,,,,,,,,,,,,folder,",
      "Postcard,,,,,,A Q,5555,999,,12/29,,,,,,,,,,,credit_card,",
    ];
    const r = read("nordpass.csv", [header, ...rows].join("\n"));
    expect(r.source).toBe("nordpass");
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toEqual({ type: "login", name: "Swisscom", url: "https://www.swisscom.ch", username: "antoine", password: "pw", notes: "Autre adresse : https://login.swisscom.ch\nClient : 42\nDossier : Maison" });
    expect(r.items[1]).toEqual({ type: "secret", name: "Wifi", notes: "mot de passe wifi" });
    expect(r.items[2].notes).toContain("Numéro : 5555");
  });
});

describe("Cairn", () => {
  const items: VaultItemData[] = [
    { type: "login", name: "A, b", url: "https://a.ch", username: "u", password: 'p"w', notes: "l1\nl2" },
    { type: "ssh", name: "VPS", host: "203.0.113.10", username: "root", privateKey: KEY, publicKey: "ssh-ed25519 C", passphrase: "pp" },
    { type: "secret", name: "Codes", notes: "123" },
  ];

  it("relit son propre CSV en clair sans rien perdre", () => {
    const r = read("cairn.csv", itemsToCsv(items));
    expect(r.source).toBe("cairn");
    expect(r.items).toEqual(items);
  });

  it("relit son JSON en clair", () => {
    const r = read("cairn.json", JSON.stringify({ format: "cairn-vault-plain", version: 1, exportedAt: "", items }));
    expect(r.items).toEqual(items);
  });

  it("ouvre un export chiffré avec son mot de passe maître, pas un autre", async () => {
    const { meta, key } = await createVault("mot de passe de l'export", { memoryKiB: 1024, iterations: 1 });
    const exp: CairnExport = { format: "cairn-vault", version: 1, exportedAt: "", meta, items: await Promise.all(items.map(async (d) => ({ data: await encryptJson(key, d) }))) };
    const locked = readImportFile("cairn-coffre.json", strToU8(JSON.stringify(exp)));
    expect("locked" in locked).toBe(true);
    await expect(openCairnExport(exp, "mauvais")).rejects.toThrow("incorrect");
    expect((await openCairnExport(exp, "mot de passe de l'export")).items).toEqual(items);
  });
});

it("reconnaît un élément déjà présent malgré la casse et les espaces", () => {
  expect(itemFingerprint({ type: "login", name: "GitHub ", username: "Antoine" })).toBe(itemFingerprint({ type: "login", name: "github", username: "antoine" }));
  expect(itemFingerprint({ type: "login", name: "GitHub", username: "a" })).not.toBe(itemFingerprint({ type: "login", name: "GitHub", username: "b" }));
});
