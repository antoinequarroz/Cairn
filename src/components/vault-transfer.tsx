"use client";

import { Download, FileUp, Globe, Loader2, StickyNote, Terminal, TriangleAlert, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { encryptJson, unlockVault } from "@/lib/crypto";
import type { VaultItem, VaultItemData, VaultItemRow, VaultItemType, VaultMeta } from "@/lib/types";
import { api, cn } from "@/lib/utils";
import {
  hostOf,
  itemFingerprint,
  itemsToCsv,
  openCairnExport,
  readImportFile,
  SOURCE_LABELS,
  type CairnExport,
  type CairnPlainExport,
  type ParsedImport,
} from "@/lib/vault-import";
import { vaultKey } from "@/lib/vault-store";
import { Button, Field, inputClass } from "./ui";

const ICONS: Record<VaultItemType, typeof Globe> = { login: Globe, ssh: Terminal, secret: StickyNote };
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

// Requests stay well under the ~1 MB the server reads comfortably, and under its 500 items per batch.
const BATCH_ITEMS = 200;
const BATCH_BYTES = 600_000;

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);
const strip = ({ id: _id, updatedAt: _u, ...data }: VaultItem): VaultItemData => (void _id, void _u, data);

/** `encrypted`: the file itself was encrypted, so there is no clear-text file left to delete. */
type Picked = { file: string; parsed: ParsedImport; encrypted: boolean } | { file: string; locked: CairnExport };

/**
 * Brings passwords in from 1Password, Bitwarden, NordPass or a browser, and takes the vault out.
 * Files are read and encrypted in this tab: the server only receives encrypted items.
 */
export function VaultTransfer({ meta, items, onClose, onImported }: { meta: VaultMeta; items: VaultItem[]; onClose: () => void; onImported: () => Promise<void> }) {
  return (
    <div className="rise flex flex-col gap-5 rounded-xl border border-line-strong bg-surface p-5 shadow-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-medium">Importer ou exporter</h2>
          <p className="mt-1 text-[13px] text-ink-3">Les fichiers sont lus et chiffrés dans ce navigateur. Le serveur ne voit jamais tes mots de passe en clair.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer" className="text-ink-3 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <Import items={items} onImported={onImported} />
      <div className="h-px bg-line" />
      <Export meta={meta} items={items} />
    </div>
  );
}

function Import({ items, onImported }: { items: VaultItem[]; onImported: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [password, setPassword] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [step, setStep] = useState("");

  const reset = () => {
    setPicked(null);
    setPassword("");
    if (input.current) input.current.value = "";
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = readImportFile(file.name, new Uint8Array(await file.arrayBuffer()));
      setPicked("locked" in result ? { file: file.name, locked: result.locked } : { file: file.name, parsed: result, encrypted: false });
      if (!("locked" in result) && !result.items.length) toast.error("Aucun élément à importer dans ce fichier.");
    } catch (e) {
      toast.error((e as Error).message);
      reset();
    }
  };

  const open = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked || !("locked" in picked)) return;
    setStep("Ouverture…");
    try {
      setPicked({ file: picked.file, parsed: await openCairnExport(picked.locked, password), encrypted: true });
      setPassword("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setStep("");
    }
  };

  const parsed = picked && "parsed" in picked ? picked.parsed : null;
  const existing = new Set(items.map((i) => itemFingerprint(i)));
  const duplicates = parsed ? parsed.items.filter((d) => existing.has(itemFingerprint(d))).length : 0;
  const toImport = parsed ? (skipDuplicates ? parsed.items.filter((d) => !existing.has(itemFingerprint(d))) : parsed.items) : [];
  const count = (t: VaultItemType) => toImport.filter((d) => d.type === t).length;

  const run = async () => {
    if (!parsed) return;
    try {
      const batches: string[][] = [[]];
      let bytes = 0;
      for (const [i, d] of toImport.entries()) {
        const key = vaultKey();
        if (!key) throw new Error("Le coffre s'est verrouillé. Rien n'a été importé.");
        if (i % 20 === 0) setStep(`Chiffrement… ${i}/${toImport.length}`);
        const blob = await encryptJson(key, d);
        if (batches.at(-1)!.length >= BATCH_ITEMS || bytes + blob.length > BATCH_BYTES) {
          batches.push([]);
          bytes = 0;
        }
        batches.at(-1)!.push(blob);
        bytes += blob.length;
      }
      let done = 0;
      for (const batch of batches) {
        setStep(`Envoi… ${done}/${toImport.length}`);
        await api("/api/vault/items", { method: "POST", json: { items: batch } });
        done += batch.length;
      }
      await onImported();
      toast.success(`${plural(done, "élément importé", "éléments importés")} depuis ${SOURCE_LABELS[parsed.source]}`, {
        description: picked && "encrypted" in picked && picked.encrypted ? undefined : "Supprime maintenant le fichier d'export : il contient tes mots de passe en clair.",
        duration: 12_000,
      });
      reset();
    } catch (e) {
      toast.error((e as Error).message);
      await onImported();
    } finally {
      setStep("");
    }
  };

  const busy = !!step;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-[13.5px] font-medium">Importer</h3>
        <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] leading-snug text-ink-3">
          <li>
            <strong className="font-medium text-ink-2">1Password</strong> : Fichier › Exporter, format 1PUX (ou CSV).
          </li>
          <li>
            <strong className="font-medium text-ink-2">Bitwarden</strong> : Outils › Exporter le coffre, format .json (pas « chiffré ») ou .csv.
          </li>
          <li>
            <strong className="font-medium text-ink-2">NordPass</strong> : Réglages › Exporter les éléments, fichier .csv.
          </li>
          <li>Aussi : l&apos;export CSV d&apos;un navigateur (Chrome, Safari, Firefox) ou un export Cairn.</li>
        </ul>
      </div>

      <input ref={input} type="file" accept=".1pux,.csv,.json,text/csv,application/json" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />

      {!picked && (
        <Button type="button" className="self-start" onClick={() => input.current?.click()}>
          <FileUp className="size-4" />
          Choisir un fichier
        </Button>
      )}

      {picked && "locked" in picked && (
        <form onSubmit={open} className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3">
          <p className="text-[12.5px] text-ink-2">
            <span className="font-medium text-ink">{picked.file}</span> est un export chiffré de Cairn ({plural(picked.locked.items.length, "élément", "éléments")}). Il s&apos;ouvre avec le mot de passe maître du coffre d&apos;où il vient.
          </p>
          <Field label="Mot de passe maître de cet export">
            <input type="password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={reset}>
              Annuler
            </Button>
            <Button variant="primary" disabled={busy || !password}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Ouvrir
            </Button>
          </div>
        </form>
      )}

      {parsed && (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3">
          <p className="text-[12.5px] text-ink-2">
            <span className="font-medium text-ink">{SOURCE_LABELS[parsed.source]}</span> · {picked?.file} : {plural(parsed.items.length, "élément trouvé", "éléments trouvés")}.
            {duplicates > 0 && ` ${plural(duplicates, "est déjà", "sont déjà")} dans le coffre.`}
          </p>
          {duplicates > 0 && (
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} className="accent-[var(--accent)]" />
              Ignorer ceux qui sont déjà dans le coffre (même nom, utilisateur et adresse)
            </label>
          )}
          {toImport.length > 0 && (
            <>
              <p className="text-[12.5px] text-ink-3">
                {[
                  count("login") && plural(count("login"), "identifiant", "identifiants"),
                  count("ssh") && plural(count("ssh"), "clé SSH", "clés SSH"),
                  count("secret") && plural(count("secret"), "note secrète", "notes secrètes"),
                ]
                  .filter(Boolean)
                  .join(", ")}
                .
                Les codes 2FA, champs personnalisés et cartes vont dans les notes de chaque élément.
              </p>
              <ul className="scroll-thin flex max-h-52 flex-col gap-0.5 overflow-y-auto rounded-md border border-line bg-surface p-1">
                {toImport.map((d, i) => {
                  const Icon = ICONS[d.type];
                  return (
                    <li key={i} className="flex items-center gap-2 rounded px-2 py-1 text-[12.5px]">
                      <Icon className="size-3.5 shrink-0 text-ink-3" />
                      <span className="truncate">{d.name}</span>
                      <span className="ml-auto truncate pl-2 text-ink-3">{d.username || (d.url && hostOf(d.url)) || d.host}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {parsed.skipped.length > 0 && (
            <details className="text-[12.5px] text-ink-3">
              <summary className="cursor-pointer">{plural(parsed.skipped.length, "élément laissé de côté", "éléments laissés de côté")}</summary>
              <ul className="mt-1 list-disc pl-5">
                {parsed.skipped.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
              Annuler
            </Button>
            <Button type="button" variant="primary" onClick={run} disabled={busy || !toImport.length}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {step || `Importer ${plural(toImport.length, "élément", "éléments")}`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Export({ meta, items }: { meta: VaultMeta; items: VaultItem[] }) {
  const [plain, setPlain] = useState(false);
  const [format, setFormat] = useState<"json" | "csv">("csv");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const encrypted = async () => {
    setBusy(true);
    try {
      // Straight from the server: the very blobs it stores, which only the master password opens.
      const d = await api<{ meta: VaultMeta; items: VaultItemRow[] }>("/api/vault");
      const exp: CairnExport = { format: "cairn-vault", version: 1, exportedAt: new Date().toISOString(), meta: d.meta, items: d.items.map((r) => ({ data: r.data })) };
      download(`cairn-coffre-chiffre-${today()}.json`, JSON.stringify(exp, null, 2), "application/json");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clear = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // Asked again on purpose: an unlocked tab left open should not be enough to take everything out.
      await unlockVault(password, meta);
      const data = items.map(strip);
      if (format === "csv") download(`cairn-coffre-en-clair-${today()}.csv`, itemsToCsv(data), "text/csv;charset=utf-8");
      else download(`cairn-coffre-en-clair-${today()}.json`, JSON.stringify({ format: "cairn-vault-plain", version: 1, exportedAt: new Date().toISOString(), items: data } satisfies CairnPlainExport, null, 2), "application/json");
      setPlain(false);
      setPassword("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-[13.5px] font-medium">Exporter</h3>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
          L&apos;export chiffré est une sauvegarde : il se réimporte dans Cairn avec ton mot de passe maître actuel. L&apos;export en clair sert à passer à un autre gestionnaire.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={encrypted} disabled={busy || !items.length}>
          <Download className="size-4" />
          Exporter chiffré
        </Button>
        {!plain && (
          <Button type="button" variant="danger" onClick={() => setPlain(true)} disabled={!items.length}>
            <TriangleAlert className="size-4" />
            Exporter en clair…
          </Button>
        )}
      </div>
      {plain && (
        <form onSubmit={clear} className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-danger/5 p-3">
          <p className="flex gap-2 text-[12.5px] leading-snug text-ink-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
            <span>
              <strong className="font-medium text-ink">Ce fichier contiendra tous tes mots de passe et clés privées, lisibles par n&apos;importe qui.</strong> Ne l&apos;envoie pas par e-mail, ne le laisse pas dans
              Téléchargements ni dans un dossier synchronisé, et supprime-le dès qu&apos;il a servi.
            </span>
          </p>
          <div className="grid grid-cols-[auto_1fr] items-end gap-3 max-md:grid-cols-1">
            <Field label="Format">
              <span className="flex rounded-lg border border-line bg-surface p-0.5">
                {(["csv", "json"] as const).map((f) => (
                  <button key={f} type="button" onClick={() => setFormat(f)} aria-pressed={format === f} className={cn("h-8 rounded-md px-3 text-[12.5px] transition-colors duration-150", format === f ? "bg-surface-2 font-medium text-ink shadow-card" : "text-ink-3 hover:text-ink")}>
                    {f === "csv" ? "CSV" : "JSON"}
                  </button>
                ))}
              </span>
            </Field>
            <Field label="Mot de passe maître, pour confirmer">
              <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => (setPlain(false), setPassword(""))}>
              Annuler
            </Button>
            <Button variant="danger" disabled={busy || !password}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Télécharger en clair
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
