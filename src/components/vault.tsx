"use client";

import { Check, Copy, Eye, EyeOff, Globe, KeyRound, Lock, Pencil, Plus, Search, ShieldCheck, StickyNote, Terminal, Trash2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { decryptJson, encryptJson, generatePassword } from "@/lib/crypto";
import type { VaultItem, VaultItemData, VaultItemRow, VaultItemType, VaultMeta } from "@/lib/types";
import { api, cn, when } from "@/lib/utils";
import { lockVault, setupVault, useVaultKey, vaultKey } from "@/lib/vault-store";
import { Button, Field, inputClass, PageHeader } from "./ui";
import { UnlockForm } from "./unlock-form";

const TYPES: Record<VaultItemType, { label: string; Icon: typeof Globe }> = {
  login: { label: "Identifiant", Icon: Globe },
  ssh: { label: "Clé SSH / VPS", Icon: Terminal },
  secret: { label: "Note secrète", Icon: StickyNote },
};

type State = { meta: VaultMeta | null; rows: VaultItemRow[] };

export function Vault() {
  const key = useVaultKey();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [items, setItems] = useState<VaultItem[]>([]);
  const [editing, setEditing] = useState<VaultItem | "new" | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(() => api<{ meta: VaultMeta | null; items: VaultItemRow[] }>("/api/vault").then((d) => setState({ meta: d.meta, rows: d.items }), (e: Error) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  // Decrypt when the vault opens, forget everything when it locks.
  useEffect(() => {
    if (!key || !state) {
      setItems([]);
      setEditing(null);
      return;
    }
    let stale = false;
    Promise.all(state.rows.map(async (r) => ({ ...(await decryptJson<VaultItemData>(key, r.data)), id: r.id, updatedAt: r.updatedAt }))).then(
      (list) => !stale && setItems(list),
      () => toast.error("Certains éléments n'ont pas pu être déchiffrés."),
    );
    return () => {
      stale = true;
    };
  }, [key, state]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => [i.name, i.username, i.url, i.host].some((v) => v?.toLowerCase().includes(q))) : items;
  }, [items, query]);

  if (error) return <Centered title="Impossible de charger le coffre" text={error} />;
  if (!state) return <div className="flex-1" />;

  if (!state.meta) return <Setup onDone={(meta) => setState({ meta, rows: [] })} />;

  if (!key)
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rise w-full max-w-[380px] rounded-2xl border border-line bg-surface p-7 shadow-card">
          <Lock className="size-6 text-accent" />
          <h1 className="mt-4 font-display text-[28px] leading-none">Coffre verrouillé</h1>
          <p className="mt-2 mb-5 text-[13px] text-ink-3">
            {state.rows.length} élément{state.rows.length > 1 ? "s" : ""}. Le déchiffrement se fait sur cet appareil : le mot de passe maître ne quitte jamais ton navigateur.
          </p>
          <UnlockForm meta={state.meta} />
        </div>
      </div>
    );

  const save = async (data: VaultItemData, id?: string) => {
    const k = vaultKey();
    if (!k) throw new Error("Le coffre s'est verrouillé.");
    const blob = await encryptJson(k, data);
    await api(id ? `/api/vault/items/${id}` : "/api/vault/items", { method: id ? "PUT" : "POST", json: { data: blob } });
    setEditing(null);
    await load();
  };

  const del = async (item: VaultItem) => {
    if (!window.confirm(`Supprimer « ${item.name} » du coffre ? C'est définitif.`)) return;
    await api(`/api/vault/items/${item.id}`, { method: "DELETE" }).catch((e: Error) => toast.error(e.message));
    await load();
  };

  return (
    <>
      <PageHeader title="Coffre" subtitle="Mots de passe et clés, chiffrés sur cet appareil avant d'être envoyés au serveur.">
        <Button onClick={lockVault}>
          <Lock className="size-4" />
          <span className="max-md:hidden">Verrouiller</span>
        </Button>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus className="size-4" strokeWidth={2.4} />
          Ajouter
        </Button>
      </PageHeader>
      <div className="scroll-thin flex-1 overflow-y-auto p-7 max-md:p-4">
        <div className="mx-auto flex max-w-[760px] flex-col gap-3">
          {editing === "new" && <ItemForm onSave={(d) => save(d)} onCancel={() => setEditing(null)} />}
          {items.length > 4 && (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher dans le coffre" aria-label="Rechercher dans le coffre" className={cn(inputClass, "pl-9")} />
            </div>
          )}
          {shown.map((item) =>
            editing !== "new" && editing?.id === item.id ? (
              <ItemForm key={item.id} item={item} onSave={(d) => save(d, item.id)} onCancel={() => setEditing(null)} />
            ) : (
              <ItemCard key={item.id} item={item} onEdit={() => setEditing(item)} onDelete={() => del(item)} />
            ),
          )}
          {!items.length && editing !== "new" && state.rows.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <ShieldCheck className="size-7 text-accent" />
              <p className="font-display text-[24px] leading-none">Le coffre est vide</p>
              <p className="max-w-[360px] text-[13.5px] text-ink-3">Ajoute un mot de passe, ou la clé SSH de ton VPS.</p>
            </div>
          )}
          {items.length > 0 && !shown.length && <p className="py-10 text-center text-[13px] text-ink-3">Aucun élément ne correspond.</p>}
        </div>
      </div>
    </>
  );
}

function Centered({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      <p className="text-[13px] text-ink-3">{text}</p>
    </div>
  );
}

function Setup({ onDone }: { onDone: (meta: VaultMeta) => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const weak = password.length > 0 && password.length < 12;
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onDone(await setupVault(password));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <form onSubmit={submit} className="rise flex w-full max-w-[420px] flex-col gap-4 rounded-2xl border border-line bg-surface p-7 shadow-card">
        <KeyRound className="size-6 text-accent" />
        <div>
          <h1 className="font-display text-[28px] leading-none">Créer le coffre</h1>
          <p className="mt-2 text-[13px] text-ink-3">Choisis un mot de passe maître, différent de celui de l&apos;app. Il chiffre tes mots de passe et tes clés sur cet appareil.</p>
        </div>
        <Field label="Mot de passe maître" hint={weak ? "Au moins 12 caractères. Une phrase de quelques mots est idéale." : undefined}>
          <input type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Confirmation" hint={mismatch ? "Les deux mots de passe sont différents." : undefined}>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </Field>
        <p className="rounded-lg border border-line bg-surface-2 p-3 text-[12.5px] leading-snug text-ink-2">
          <strong className="font-medium text-ink">Il ne peut pas être récupéré.</strong> Personne, pas même le serveur, ne peut ouvrir le coffre sans lui. Note-le dans un endroit sûr.
        </p>
        {error && <p className="text-[12.5px] text-danger">{error}</p>}
        <Button variant="primary" disabled={busy || password.length < 12 || password !== confirm}>
          {busy ? "Création…" : "Créer le coffre"}
        </Button>
      </form>
    </div>
  );
}

function ItemCard({ item, onEdit, onDelete }: { item: VaultItem; onEdit: () => void; onDelete: () => void }) {
  const { label, Icon } = TYPES[item.type] ?? TYPES.secret;
  const sub = item.type === "ssh" ? [item.username, item.host].filter(Boolean).join("@") : item.type === "login" ? item.username || item.url : label;
  return (
    <div className="rise rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{item.name}</span>
          <span className="block truncate text-[12px] text-ink-3">
            {sub || label} · modifié {when(item.updatedAt)}
          </span>
        </span>
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Modifier ${item.name}`}>
          <Pencil className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Supprimer ${item.name}`}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {item.url && <Row label="Adresse" value={item.url} />}
        {item.host && <Row label="Serveur" value={item.host} />}
        {item.username && <Row label="Utilisateur" value={item.username} />}
        {item.type === "ssh" && item.host && <Row label="Commande" value={`ssh ${item.username ? `${item.username}@` : ""}${item.host}`} />}
        {item.password && <Row label="Mot de passe" value={item.password} secret />}
        {item.publicKey && <Row label="Clé publique" value={item.publicKey} />}
        {item.privateKey && <Row label="Clé privée" value={item.privateKey} secret />}
        {item.passphrase && <Row label="Phrase secrète" value={item.passphrase} secret />}
        {item.notes && <Row label="Notes" value={item.notes} secret={item.type === "secret"} />}
      </div>
    </div>
  );
}

function Row({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const multiline = value.includes("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      // A copied secret should not stay in the clipboard forever.
      if (secret) setTimeout(() => navigator.clipboard.readText().then((t) => { if (t === value) return navigator.clipboard.writeText(""); }).catch(() => {}), 45_000);
    } catch {
      toast.error("Copie impossible");
    }
  };

  return (
    <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2">
      <span className="w-[104px] shrink-0 pt-px text-[12px] text-ink-3">{label}</span>
      <span className={cn("min-w-0 flex-1 font-mono text-[12.5px]", multiline && shown ? "max-h-40 overflow-y-auto break-all whitespace-pre-wrap" : "truncate")}>
        {secret && !shown ? "••••••••••••" : value}
      </span>
      {secret && (
        <button onClick={() => setShown(!shown)} aria-label={shown ? `Masquer ${label}` : `Afficher ${label}`} className="text-ink-3 hover:text-ink">
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      )}
      <button onClick={copy} aria-label={`Copier ${label}`} className={cn("hover:text-ink", copied ? "text-ok" : "text-ink-3")}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

function ItemForm({ item, onSave, onCancel }: { item?: VaultItem; onSave: (data: VaultItemData) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState<VaultItemData>(() => {
    if (!item) return { type: "login", name: "" };
    const { id: _id, updatedAt: _u, ...data } = item;
    void _id;
    void _u;
    return data;
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<VaultItemData>) => setD((cur) => ({ ...cur, ...patch }));
  const area = cn(inputClass, "h-auto min-h-24 py-2 font-mono text-[12.5px]");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // Only the fields of the chosen type, without empty ones.
    const keep: (keyof VaultItemData)[] = d.type === "login" ? ["url", "username", "password", "notes"] : d.type === "ssh" ? ["host", "username", "privateKey", "publicKey", "passphrase", "notes"] : ["notes"];
    const clean: VaultItemData = { type: d.type, name: d.name.trim() };
    for (const k of keep) if (d[k]) (clean as Record<string, string>)[k] = d[k] as string;
    try {
      await onSave(clean);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rise flex flex-col gap-3 rounded-xl border border-line-strong bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
          {(Object.keys(TYPES) as VaultItemType[]).map((t) => (
            <button key={t} type="button" onClick={() => set({ type: t })} aria-pressed={d.type === t} className={cn("h-7 rounded-md px-2.5 text-[12.5px] transition-colors duration-150", d.type === t ? "bg-surface font-medium text-ink shadow-card" : "text-ink-3 hover:text-ink")}>
              {TYPES[t].label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onCancel} aria-label="Annuler" className="ml-auto text-ink-3 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <Field label="Nom">
        <input autoFocus required value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder={d.type === "ssh" ? "VPS principal" : d.type === "login" ? "GitHub" : "Codes de secours"} className={inputClass} />
      </Field>
      {d.type === "login" && (
        <>
          <Field label="Adresse">
            <input value={d.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Utilisateur">
            <input value={d.username ?? ""} onChange={(e) => set({ username: e.target.value })} autoComplete="off" className={inputClass} />
          </Field>
          <Field label="Mot de passe">
            <span className="flex gap-2">
              <input value={d.password ?? ""} onChange={(e) => set({ password: e.target.value })} autoComplete="off" className={cn(inputClass, "font-mono")} />
              <Button type="button" className="h-10" onClick={() => set({ password: generatePassword() })} title="Générer un mot de passe">
                <Wand2 className="size-4" />
                Générer
              </Button>
            </span>
          </Field>
        </>
      )}
      {d.type === "ssh" && (
        <>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <Field label="Serveur">
              <input value={d.host ?? ""} onChange={(e) => set({ host: e.target.value })} placeholder="vps.exemple.ch ou 203.0.113.10" autoComplete="off" className={inputClass} />
            </Field>
            <Field label="Utilisateur">
              <input value={d.username ?? ""} onChange={(e) => set({ username: e.target.value })} placeholder="root" autoComplete="off" className={inputClass} />
            </Field>
          </div>
          <Field label="Clé privée">
            <textarea value={d.privateKey ?? ""} onChange={(e) => set({ privateKey: e.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" spellCheck={false} className={area} />
          </Field>
          <Field label="Clé publique">
            <input value={d.publicKey ?? ""} onChange={(e) => set({ publicKey: e.target.value })} placeholder="ssh-ed25519 AAAA…" spellCheck={false} className={cn(inputClass, "font-mono text-[12.5px]")} />
          </Field>
          <Field label="Phrase secrète de la clé">
            <input value={d.passphrase ?? ""} onChange={(e) => set({ passphrase: e.target.value })} autoComplete="off" className={cn(inputClass, "font-mono")} />
          </Field>
        </>
      )}
      <Field label={d.type === "secret" ? "Contenu" : "Notes"}>
        <textarea value={d.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} spellCheck={false} className={area} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
        <Button variant="primary" disabled={busy || !d.name.trim()}>
          {busy ? "Chiffrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
