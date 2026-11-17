// Reading the exports of other password managers, and Cairn's own exports, into vault items.
// Runs in the browser only: the clear text of these files must never reach the server. What
// comes out of here is encrypted with the vault key before it is sent (see vault-transfer.tsx).
import { unzipSync } from "fflate";
import { decryptJson, unlockVault } from "./crypto";
import type { VaultItemData, VaultMeta } from "./types";

export type ImportSource = "1password" | "bitwarden" | "nordpass" | "cairn" | "csv";

export const SOURCE_LABELS: Record<ImportSource, string> = {
  "1password": "1Password",
  bitwarden: "Bitwarden",
  nordpass: "NordPass",
  cairn: "Cairn",
  csv: "CSV",
};

export type ParsedImport = { source: ImportSource; items: VaultItemData[]; skipped: string[] };

/** Cairn's encrypted export: the vault as the server stores it. Opening it takes its master password. */
export type CairnExport = { format: "cairn-vault"; version: 1; exportedAt: string; meta: VaultMeta; items: { data: string }[] };
export type CairnPlainExport = { format: "cairn-vault-plain"; version: 1; exportedAt: string; items: VaultItemData[] };

export type LockedImport = { source: "cairn"; locked: CairnExport };

// ─── CSV ────────────────────────────────────────────────────────────────────────────────────────

/** RFC 4180: quoted fields, doubled quotes, line breaks inside quotes, CRLF or LF, optional BOM. */
export function parseCsv(input: string): string[][] {
  const s = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim()));
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** Rows as objects keyed by the lower-cased header. */
function records(text: string): { header: string[]; rows: Record<string, string>[] } {
  const [head = [], ...body] = parseCsv(text);
  const header = head.map((h) => h.trim().toLowerCase());
  return { header, rows: body.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}

const pick = (r: Record<string, string>, ...names: string[]) => names.map((n) => r[n]).find((v) => v) ?? "";

// ─── Building items ─────────────────────────────────────────────────────────────────────────────

type Extra = [label: string, value: string | undefined];

/** Notes, followed by the fields Cairn has no place for (2FA codes, custom fields, card details…). */
function notesWith(notes: string | undefined, extras: Extra[]) {
  const lines = extras.filter(([, v]) => v?.trim()).map(([k, v]) => (v!.includes("\n") ? `${k} :\n${v!.trim()}` : `${k} : ${v!.trim()}`));
  return [notes?.trim(), lines.join("\n")].filter(Boolean).join("\n\n") || undefined;
}

const PEM = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]+?-----END \1PRIVATE KEY-----/;

/** The host name of an address, with or without its scheme. */
export function hostOf(url: string) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return "";
  }
}

/** Drops empty fields, names the nameless, and turns a secret note holding a private key into an SSH key. */
function finish(d: VaultItemData): VaultItemData | null {
  const out: VaultItemData = { type: d.type, name: "" };
  for (const [k, v] of Object.entries(d)) if (typeof v === "string" && v.trim() && k !== "type") (out as Record<string, string>)[k] = v.trim();
  if (out.type === "secret" && out.notes && !out.privateKey) {
    const key = out.notes.match(PEM);
    if (key) {
      out.type = "ssh";
      out.privateKey = key[0];
      const rest = out.notes.replace(key[0], "").trim();
      if (rest) out.notes = rest;
      else delete out.notes;
    }
  }
  if (!out.name) out.name = (out.url && hostOf(out.url)) || out.host || out.username || "Sans titre";
  const empty = !out.username && !out.password && !out.url && !out.host && !out.privateKey && !out.publicKey && !out.notes;
  return empty ? null : out;
}

function collect(source: ImportSource, list: (VaultItemData | string | null)[]): ParsedImport {
  const items: VaultItemData[] = [];
  const skipped: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string") skipped.push(entry);
    else if (entry) {
      const item = finish(entry);
      if (item) items.push(item);
    }
  }
  return { source, items, skipped };
}

// ─── 1Password (.1pux) ──────────────────────────────────────────────────────────────────────────

type OpValue = Record<string, unknown>;
type OpField = { title?: string; id?: string; value?: OpValue };
type OpItem = {
  state?: string;
  categoryUuid?: string;
  overview?: { title?: string; url?: string; urls?: { url?: string }[]; tags?: string[] };
  details?: {
    loginFields?: { value?: string; name?: string; designation?: string; fieldType?: string }[];
    notesPlain?: string;
    password?: string;
    sections?: { title?: string; fields?: OpField[] }[];
  };
};

/** One 1Password field value, whatever its kind, as text. */
function opText(value: OpValue | undefined): string {
  if (!value) return "";
  const [kind, v] = Object.entries(value)[0] ?? [];
  if (v === null || v === undefined || v === "") return "";
  if (kind === "sshKey") return String((v as { privateKey?: string }).privateKey ?? "");
  if (kind === "email") return String((v as { email_address?: string }).email_address ?? "");
  if (kind === "date" && typeof v === "number") return new Date(v * 1000).toISOString().slice(0, 10);
  if (kind === "monthYear" && typeof v === "number") return `${String(v % 100).padStart(2, "0")}/${Math.floor(v / 100)}`;
  if (kind === "address" && typeof v === "object") return Object.values(v as Record<string, string>).filter(Boolean).join(", ");
  if (kind === "file" || kind === "reference" || typeof v === "object") return "";
  return String(v);
}

const OP_CATEGORIES: Record<string, string> = {
  "002": "Carte bancaire",
  "004": "Identité",
  "101": "Compte bancaire",
  "102": "Base de données",
  "103": "Permis de conduire",
  "106": "Passeport",
  "109": "Routeur Wi-Fi",
  "111": "Compte e-mail",
  "112": "Identifiants d'API",
  "115": "Portefeuille crypto",
};

function from1PasswordItem(it: OpItem, vault: string): VaultItemData | string | null {
  const title = it.overview?.title?.trim() || "Sans titre";
  if (it.state === "archived") return `${title} (archivé)`;
  if (it.categoryUuid === "006") return `${title} (document joint, à récupérer à part)`;
  const d = it.details ?? {};
  const urls = [it.overview?.url, ...(it.overview?.urls ?? []).map((u) => u.url)].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
  const fields = (d.sections ?? []).flatMap((s) => (s.fields ?? []).map((f) => ({ ...f, section: s.title })));
  const used = new Set<OpField>();
  const take = (test: (f: OpField) => boolean) => {
    const f = fields.find((x) => !used.has(x) && test(x) && opText(x.value));
    if (f) used.add(f);
    return f ? opText(f.value) : "";
  };
  const login = d.loginFields ?? [];
  const totp = take((f) => !!f.value && "totp" in f.value);

  let item: VaultItemData;
  if (it.categoryUuid === "114") {
    const keyField = fields.find((f) => f.value && "sshKey" in f.value);
    if (keyField) used.add(keyField);
    const meta = (keyField?.value?.sshKey as { metadata?: { publicKey?: string } } | undefined)?.metadata;
    item = { type: "ssh", name: title, privateKey: opText(keyField?.value), publicKey: meta?.publicKey };
  } else if (it.categoryUuid === "001" || it.categoryUuid === "005" || it.categoryUuid === "110" || (!it.categoryUuid && login.length)) {
    item = {
      type: "login",
      name: title,
      url: urls[0] || take((f) => f.id === "url" || /^(url|site|website)$/i.test(f.title ?? "")),
      username: login.find((f) => f.designation === "username")?.value || take((f) => f.id === "username" || /^(username|nom d'utilisateur|utilisateur)$/i.test(f.title ?? "")),
      password: login.find((f) => f.designation === "password")?.value || d.password || take((f) => f.id === "password" || /^(password|mot de passe)$/i.test(f.title ?? "")),
    };
  } else {
    item = { type: "secret", name: title };
  }

  const rest: Extra[] = fields.filter((f) => !used.has(f)).map((f) => [f.title || f.id || "Champ", opText(f.value)]);
  const category = OP_CATEGORIES[it.categoryUuid ?? ""];
  item.notes = notesWith(d.notesPlain, [
    ...(category && item.type === "secret" ? ([["Type", category]] as Extra[]) : []),
    ["Code 2FA (TOTP)", totp],
    ...urls.slice(item.type === "login" ? 1 : 0).map((u): Extra => ["Autre adresse", u]),
    ...login.filter((f) => f.designation !== "username" && f.designation !== "password").map((f): Extra => [f.name || "Champ", f.value]),
    ...rest,
    ["Étiquettes", it.overview?.tags?.join(", ")],
    ["Coffre 1Password", vault],
  ]);
  return item;
}

function parse1pux(bytes: Uint8Array): ParsedImport {
  let files: Record<string, Uint8Array>;
  try {
    // Only the index: attachments can be large and Cairn's vault has no place for them.
    files = unzipSync(bytes, { filter: (f) => f.name === "export.data" });
  } catch {
    throw new Error("Ce fichier .1pux est illisible.");
  }
  if (!files["export.data"]) throw new Error("Ce fichier .1pux ne contient pas d'export 1Password.");
  const data = JSON.parse(new TextDecoder().decode(files["export.data"])) as { accounts?: { vaults?: { attrs?: { name?: string }; items?: OpItem[] }[] }[] };
  const list = (data.accounts ?? []).flatMap((a) => (a.vaults ?? []).flatMap((v) => (v.items ?? []).map((it) => from1PasswordItem(it, (data.accounts?.length ?? 0) > 1 || (a.vaults?.length ?? 0) > 1 ? (v.attrs?.name ?? "") : ""))));
  return collect("1password", list);
}

// ─── Bitwarden ──────────────────────────────────────────────────────────────────────────────────

type BwItem = {
  type?: number;
  name?: string;
  notes?: string | null;
  folderId?: string | null;
  fields?: { name?: string | null; value?: string | null; type?: number }[] | null;
  login?: { username?: string | null; password?: string | null; totp?: string | null; uris?: { uri?: string | null }[] | null } | null;
  card?: Record<string, string | null> | null;
  identity?: Record<string, string | null> | null;
  sshKey?: { privateKey?: string | null; publicKey?: string | null; keyFingerprint?: string | null } | null;
};

const BW_CARD: Record<string, string> = { cardholderName: "Titulaire", brand: "Marque", number: "Numéro", expMonth: "Mois d'expiration", expYear: "Année d'expiration", code: "Code de sécurité" };
const BW_IDENTITY: Record<string, string> = {
  title: "Civilité",
  firstName: "Prénom",
  middleName: "Deuxième prénom",
  lastName: "Nom",
  email: "E-mail",
  phone: "Téléphone",
  company: "Entreprise",
  address1: "Adresse",
  address2: "Adresse (suite)",
  address3: "Adresse (suite)",
  postalCode: "Code postal",
  city: "Ville",
  state: "Région",
  country: "Pays",
  ssn: "N° AVS / sécurité sociale",
  username: "Nom d'utilisateur",
  passportNumber: "N° de passeport",
  licenseNumber: "N° de permis",
};

const labelled = (obj: Record<string, string | null> | null | undefined, labels: Record<string, string>): Extra[] => Object.entries(labels).map(([k, label]) => [label, obj?.[k] ?? undefined]);

function fromBitwardenJson(data: { encrypted?: boolean; folders?: { id: string; name: string }[]; items?: BwItem[] }): ParsedImport {
  if (data.encrypted) throw new Error("Cet export Bitwarden est chiffré. Exporte-le à nouveau au format « .json » (non chiffré), puis supprime le fichier après l'import.");
  const folders = new Map((data.folders ?? []).map((f) => [f.id, f.name]));
  const list = (data.items ?? []).map((it): VaultItemData | string => {
    const name = it.name?.trim() || "";
    const fields: Extra[] = (it.fields ?? []).filter((f) => f.type !== 3).map((f) => [f.name || "Champ", f.value ?? undefined]);
    const folder: Extra = ["Dossier", it.folderId ? folders.get(it.folderId) : undefined];
    const notes = it.notes ?? undefined;
    switch (it.type) {
      case 1: {
        const uris = (it.login?.uris ?? []).map((u) => u.uri).filter((u): u is string => !!u);
        return {
          type: "login",
          name,
          url: uris[0],
          username: it.login?.username ?? undefined,
          password: it.login?.password ?? undefined,
          notes: notesWith(notes, [["Code 2FA (TOTP)", it.login?.totp ?? undefined], ...uris.slice(1).map((u): Extra => ["Autre adresse", u]), ...fields, folder]),
        };
      }
      case 3:
        return { type: "secret", name, notes: notesWith(notes, [["Type", "Carte bancaire"], ...labelled(it.card, BW_CARD), ...fields, folder]) };
      case 4:
        return { type: "secret", name, notes: notesWith(notes, [["Type", "Identité"], ...labelled(it.identity, BW_IDENTITY), ...fields, folder]) };
      case 5:
        return { type: "ssh", name, privateKey: it.sshKey?.privateKey ?? undefined, publicKey: it.sshKey?.publicKey ?? undefined, notes: notesWith(notes, [["Empreinte", it.sshKey?.keyFingerprint ?? undefined], ...fields, folder]) };
      case 2:
        return { type: "secret", name, notes: notesWith(notes, [...fields, folder]) };
      default:
        return `${name || "Sans titre"} (type inconnu)`;
    }
  });
  return collect("bitwarden", list);
}

/** Bitwarden's "name: value" custom fields, one per line. */
const bwCsvFields = (s: string): Extra[] =>
  s
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(": ");
      return i > 0 ? [line.slice(0, i), line.slice(i + 2)] : ["Champ", line];
    });

function fromBitwardenCsv(rows: Record<string, string>[]): ParsedImport {
  const list = rows.map((r): VaultItemData => {
    const uris = r.login_uri ? r.login_uri.split(/,(?=\s*[a-z][a-z0-9+.-]*:)/i).map((u) => u.trim()) : [];
    const extras: Extra[] = [["Code 2FA (TOTP)", r.login_totp], ...uris.slice(1).map((u): Extra => ["Autre adresse", u]), ...bwCsvFields(r.fields ?? ""), ["Dossier", r.folder]];
    if (r.type === "note" || (!r.type && !r.login_username && !r.login_password && !uris.length)) return { type: "secret", name: r.name, notes: notesWith(r.notes, extras) };
    return { type: "login", name: r.name, url: uris[0], username: r.login_username, password: r.login_password, notes: notesWith(r.notes, extras) };
  });
  return collect("bitwarden", list);
}

// ─── NordPass (.csv) ────────────────────────────────────────────────────────────────────────────

/** NordPass writes lists as JSON inside a cell: `["https://a", "https://b"]` or `[{"label": …, "value": …}]`. */
function jsonCell<T>(s: string | undefined): T[] {
  if (!s?.trim()) return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [s as unknown as T];
  }
}

function fromNordPass(rows: Record<string, string>[]): ParsedImport {
  const list = rows.map((r): VaultItemData | string | null => {
    const type = (r.type ?? "").toLowerCase();
    const custom: Extra[] = jsonCell<{ label?: string; value?: string } | string>(r.custom_fields).map((f) => (typeof f === "string" ? ["Champ", f] : [f.label || "Champ", f.value]));
    const urls = [r.url, ...jsonCell<string | { url?: string }>(r.additional_urls).map((u) => (typeof u === "string" ? u : u.url))].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
    const folder: Extra = ["Dossier", r.folder];
    const card: Extra[] = [["Type", "Carte bancaire"], ["Titulaire", r.cardholdername], ["Numéro", r.cardnumber], ["Code de sécurité", r.cvc], ["NIP", r.pin], ["Expiration", r.expirydate], ["Code postal", r.zipcode]];
    const identity: Extra[] = [["Type", "Identité"], ["Nom complet", r.full_name], ["E-mail", r.email], ["Téléphone", r.phone_number], ["Adresse", r.address1], ["Adresse (suite)", r.address2], ["Code postal", r.zipcode], ["Ville", r.city], ["Région", r.state], ["Pays", r.country]];
    const isCard = type === "credit_card" || (!type && !!r.cardnumber);
    const isIdentity = type === "identity" || (!type && !!(r.full_name || r.address1 || r.phone_number));
    const isLogin = type === "password" || (!type && !!(r.username || r.password || urls.length));
    if (type === "folder" || (!type && !isCard && !isIdentity && !isLogin && !r.note)) return null;
    if (isLogin) return { type: "login", name: r.name, url: urls[0], username: r.username || r.email, password: r.password, notes: notesWith(r.note, [...urls.slice(1).map((u): Extra => ["Autre adresse", u]), ...custom, folder]) };
    if (isCard) return { type: "secret", name: r.name, notes: notesWith(r.note, [...card, ...custom, folder]) };
    if (isIdentity) return { type: "secret", name: r.name, notes: notesWith(r.note, [...identity, ...custom, folder]) };
    if (type && type !== "note") return { type: "secret", name: r.name, notes: notesWith(r.note, [["Type", type], ...custom, folder]) };
    return { type: "secret", name: r.name, notes: notesWith(r.note, [...custom, folder]) };
  });
  return collect("nordpass", list);
}

// ─── 1Password CSV, browsers, Cairn CSV and other CSV files ─────────────────────────────────────

function fromGenericCsv(source: ImportSource, rows: Record<string, string>[]): ParsedImport {
  const list = rows.map((r): VaultItemData => {
    const type = pick(r, "type").toLowerCase();
    const name = pick(r, "title", "name", "nom");
    const extras: Extra[] = [
      ["Code 2FA (TOTP)", pick(r, "otpauth", "totp", "otp")],
      ["Étiquettes", pick(r, "tags")],
      ["Dossier", pick(r, "folder", "grouping", "group")],
    ];
    const notes = notesWith(pick(r, "notes", "note", "extra", "comments"), extras);
    if (type === "ssh" || r.private_key) return { type: "ssh", name, host: pick(r, "host"), username: pick(r, "username"), privateKey: r.private_key, publicKey: r.public_key, passphrase: r.passphrase, notes };
    const login = {
      url: pick(r, "url", "website", "login_uri", "uri", "web site"),
      username: pick(r, "username", "login", "login_username", "email", "user name"),
      password: pick(r, "password", "login_password"),
    };
    if (type === "secret" || type === "note" || (!type && !login.url && !login.username && !login.password)) return { type: "secret", name, notes };
    return { type: "login", name, ...login, notes };
  });
  return collect(source, list);
}

function parseCsvFile(text: string): ParsedImport {
  const { header, rows } = records(text);
  const has = (...cols: string[]) => cols.some((c) => header.includes(c));
  if (has("login_uri", "login_password", "login_username")) return fromBitwardenCsv(rows);
  if (has("cardholdername", "additional_urls", "custom_fields") || (has("note") && has("full_name"))) return fromNordPass(rows);
  if (has("private_key") && has("passphrase")) return fromGenericCsv("cairn", rows);
  if (!has("password", "login_password") && !has("notes", "note")) throw new Error("Colonnes non reconnues. Attendu : un export CSV de 1Password, Bitwarden, NordPass ou d'un navigateur.");
  const onePassword = has("archived", "favorite", "website") && has("title");
  return fromGenericCsv(onePassword ? "1password" : "csv", rows);
}

// ─── Entry points ───────────────────────────────────────────────────────────────────────────────

/**
 * Reads an export file. Recognized: 1Password (.1pux, .csv), Bitwarden (.json, .csv), NordPass (.csv),
 * browsers (.csv) and Cairn's own exports. A Cairn encrypted export comes back locked: open it with
 * openCairnExport() and its master password.
 */
export function readImportFile(name: string, bytes: Uint8Array): ParsedImport | LockedImport {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (/\.1pux$/i.test(name) || isZip) return parse1pux(bytes);
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, "");
  if (/\.json$/i.test(name) || /^\s*[{[]/.test(text)) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("Ce fichier JSON est illisible.");
    }
    if (data.format === "cairn-vault") {
      const exp = data as unknown as CairnExport;
      if (!exp.meta?.wrappedKey || !Array.isArray(exp.items)) throw new Error("Cet export Cairn est incomplet.");
      return { source: "cairn", locked: exp };
    }
    if (data.format === "cairn-vault-plain" && Array.isArray(data.items)) return collect("cairn", (data.items as VaultItemData[]).map(sanitize));
    if (Array.isArray(data.items) || "encrypted" in data) return fromBitwardenJson(data);
    throw new Error("Ce fichier JSON n'est ni un export Bitwarden ni un export Cairn.");
  }
  return parseCsvFile(text);
}

const FIELDS = ["name", "username", "password", "url", "host", "privateKey", "publicKey", "passphrase", "notes"] as const;

/** Only the known fields of a Cairn item, as text. */
function sanitize(raw: VaultItemData): VaultItemData | string {
  if (!raw || typeof raw !== "object") return "Élément illisible";
  const type = raw.type === "login" || raw.type === "ssh" || raw.type === "secret" ? raw.type : "secret";
  const out: VaultItemData = { type, name: "" };
  for (const k of FIELDS) if (typeof raw[k] === "string") out[k] = raw[k];
  return out;
}

/** Opens a Cairn encrypted export with the master password it was made with. */
export async function openCairnExport(exp: CairnExport, password: string): Promise<ParsedImport> {
  const key = await unlockVault(password, exp.meta);
  const list = await Promise.all(exp.items.map((r) => decryptJson<VaultItemData>(key, r.data).then(sanitize, () => "Élément illisible")));
  return collect("cairn", list);
}

/** What makes two items the same, to skip what the vault already holds when importing twice. */
export const itemFingerprint = (d: VaultItemData) => [d.type, d.name, d.username, d.url, d.host].map((v) => (v ?? "").trim().toLowerCase()).join("\u0000");

// ─── Export ─────────────────────────────────────────────────────────────────────────────────────

export const CSV_COLUMNS = ["type", "name", "url", "username", "password", "host", "private_key", "public_key", "passphrase", "notes"] as const;

/** Clear-text CSV: name, url, username, password and notes are read by most password managers. */
export function itemsToCsv(items: VaultItemData[]) {
  return toCsv([
    [...CSV_COLUMNS],
    ...items.map((d) => [d.type, d.name, d.url ?? "", d.username ?? "", d.password ?? "", d.host ?? "", d.privateKey ?? "", d.publicKey ?? "", d.passphrase ?? "", d.notes ?? ""]),
  ]);
}
