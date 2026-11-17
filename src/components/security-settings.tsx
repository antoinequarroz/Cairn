"use client";

import { Archive, Check, Copy, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, cn } from "@/lib/utils";
import { Button, Field, inputClass } from "./ui";

type Status = { enabled: boolean; enabledAt?: string; recoveryLeft?: number; broken?: boolean };
type Setup = { secret: string; uri: string; qr: string };
type Backup = {
  status: { ok: boolean; at: string; bytes?: number; offsite?: boolean; error?: string; lastOkAt?: string } | null;
  late: boolean;
};

const date = (iso: string) => new Date(iso).toLocaleString("fr-CH", { dateStyle: "medium", timeStyle: "short" });
const size = (bytes: number) => (bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} Go` : bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} Mo` : `${Math.ceil(bytes / 1e3)} ko`);

/** Réglages > Sécurité: two-factor sign-in, and what the nightly backup last reported. */
export function SecuritySettings({ passwordRequired }: { passwordRequired: boolean }) {
  return (
    <>
      <TwoFactor passwordRequired={passwordRequired} />
      <BackupCard />
    </>
  );
}

function TwoFactor({ passwordRequired }: { passwordRequired: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [mode, setMode] = useState<"disable" | "recovery" | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<Status>("/api/settings/two-factor").then(setStatus, () => {});
  useEffect(() => {
    void load();
  }, []);

  const reset = () => {
    setSetup(null);
    setMode(null);
    setPassword("");
    setCode("");
  };

  const run = async (json: Record<string, unknown>) => {
    setBusy(true);
    try {
      return await api<{ secret?: string; uri?: string; qr?: string; recoveryCodes?: string[] | null }>("/api/settings/two-factor", { method: "POST", json });
    } catch (err) {
      toast.error((err as Error).message);
      setCode("");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    const res = await run({ action: "setup" });
    if (res?.secret) setSetup(res as Setup);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (setup) {
      const res = await run({ action: "enable", secret: setup.secret, code, password });
      if (!res) return;
      setCodes(res.recoveryCodes ?? null);
      reset();
      toast("Double authentification activée", { description: "Les autres appareils devront se reconnecter avec un code." });
    } else if (mode) {
      const res = await run({ action: mode, code, password });
      if (!res) return;
      if (mode === "recovery") {
        setCodes(res.recoveryCodes ?? null);
        toast("Nouveaux codes de secours", { description: "Les anciens ne marchent plus." });
      } else {
        setCodes(null);
        toast("Double authentification désactivée");
      }
      reset();
    }
    void load();
  };

  const copyCodes = async () => {
    if (!codes) return;
    await navigator.clipboard.writeText(codes.join("\n"));
    toast("Codes copiés");
  };

  const asking = !!setup || !!mode;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
      <div>
        <h2 className="flex items-center gap-1.5 text-[15px] font-medium">
          <ShieldCheck className="size-4 text-accent" />
          Double authentification
          {status?.enabled && <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Active</span>}
        </h2>
        <p className="mt-1 text-[13px] text-ink-3">
          {!status
            ? "Un instant…"
            : status.broken
              ? "Le fichier two-factor.json est illisible : personne ne peut se connecter tant qu'il n'est pas réparé ou supprimé sur le serveur (voir docs/SECURITE.md)."
              : status.enabled
                ? `Depuis le ${date(status.enabledAt!)}, un code de ton téléphone est demandé après le mot de passe. Il reste ${status.recoveryLeft} code${status.recoveryLeft === 1 ? "" : "s"} de secours.`
                : "Après le mot de passe, Cairn demande aussi un code à 6 chiffres de ton téléphone (1Password, Authy, Google Authenticator, l'app Mots de passe d'Apple…). Un mot de passe volé ne suffit plus."}
        </p>
      </div>

      {codes && (
        <div className="rounded-lg border border-accent/30 bg-accent-soft/40 p-4">
          <p className="text-[13px] font-medium">Tes codes de secours</p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Chacun remplace une fois le code du téléphone, si tu le perds. Garde-les hors de Cairn (imprimés, ou dans un autre gestionnaire). Ils ne seront plus affichés.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[13.5px]">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={copyCodes}>
              <Copy className="size-3.5" />
              Copier
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCodes(null)}>
              <Check className="size-3.5" />
              Je les ai rangés
            </Button>
          </div>
        </div>
      )}

      {status && !status.broken && !asking && (
        <div className="flex flex-wrap gap-2">
          {status.enabled ? (
            <>
              <Button onClick={() => setMode("recovery")}>Nouveaux codes de secours</Button>
              <Button variant="danger" onClick={() => setMode("disable")}>
                Désactiver
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={start} disabled={busy}>
              Activer
            </Button>
          )}
        </div>
      )}

      {asking && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          {setup && (
            <div className="flex gap-4 max-sm:flex-col">
              {/* SVG made by the server from the otpauth link (qrcode library): no user content inside. */}
              <div className="size-[148px] shrink-0 rounded-lg bg-white p-2 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: setup.qr }} />
              <div className="flex min-w-0 flex-col gap-1.5 text-[12.5px] text-ink-3">
                <p>1. Scanne ce QR code avec ton app d&apos;authentification.</p>
                <p>
                  Sur ce téléphone même :{" "}
                  <a href={setup.uri} className="text-accent hover:underline">
                    ouvrir dans l&apos;app
                  </a>
                  , ou saisis la clé à la main :
                </p>
                <code className="break-all rounded bg-surface-2 px-2 py-1 font-mono text-[12px] text-ink">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
                <p>2. Entre ton mot de passe et le code que l&apos;app affiche.</p>
              </div>
            </div>
          )}
          {passwordRequired && (
            <Field label="Mot de passe de l'app">
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            </Field>
          )}
          <Field label={setup ? "Code à 6 chiffres" : "Code à 6 chiffres ou code de secours"}>
            <input
              autoComplete="one-time-code"
              inputMode={setup ? "numeric" : "text"}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={cn(inputClass, "font-mono tracking-[0.15em]")}
              maxLength={20}
            />
          </Field>
          <div className="flex gap-2">
            <Button variant={mode === "disable" ? "danger" : "primary"} disabled={busy || !code.trim() || (passwordRequired && !password)}>
              {busy ? "Vérification…" : setup ? "Activer" : mode === "disable" ? "Désactiver" : "Générer de nouveaux codes"}
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              Annuler
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function BackupCard() {
  const [backup, setBackup] = useState<Backup | null>(null);
  useEffect(() => {
    api<Backup>("/api/settings/backup").then(setBackup, () => {});
  }, []);

  const s = backup?.status;
  const lastOk = s?.ok ? s.at : s?.lastOkAt;
  const warn = !!backup && (backup.late || (s && !s.ok));

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="flex items-center gap-1.5 text-[15px] font-medium">
        <Archive className="size-4 text-accent" />
        Sauvegardes
        {backup && <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[11px] font-medium", warn ? "bg-danger/10 text-danger" : "bg-accent-soft text-accent")}>{warn ? "À vérifier" : "À jour"}</span>}
      </h2>
      <p className="text-[13px] text-ink-3">
        {!backup
          ? "Un instant…"
          : !s
            ? "Aucune sauvegarde signalée. Programme deploy/backup.sh chaque nuit sur le VPS (docs/DEPLOIEMENT.md, étape 5)."
            : s.ok
              ? `Dernière sauvegarde le ${date(s.at)}${s.bytes ? `, ${size(s.bytes)}` : ""}, chiffrée${s.offsite ? " et copiée hors du VPS" : ", mais gardée seulement sur le VPS"}.`
              : `La dernière sauvegarde a échoué le ${date(s.at)} : ${s.error ?? "erreur inconnue"}.${lastOk ? ` La dernière réussie date du ${date(lastOk)}.` : ""}`}
        {backup?.late && s?.ok && " Elle a plus de 36 heures : la tâche cron tourne-t-elle encore ?"}
      </p>
    </section>
  );
}
