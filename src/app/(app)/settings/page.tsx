"use client";

import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AiSettings } from "@/components/ai-settings";
import { ImportNotes } from "@/components/import-notes";
import { SecuritySettings } from "@/components/security-settings";
import { Button, Field, inputClass, PageHeader } from "@/components/ui";
import { api } from "@/lib/utils";
import { lockVault } from "@/lib/vault-store";

type Source = { source: "app" | "env" | "none"; changedAt?: string };

export default function SettingsPage() {
  const [source, setSource] = useState<Source | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Source>("/api/settings/password").then(setSource, () => {});
  }, []);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/settings/password", { method: "POST", json: { current, next } });
      setCurrent("");
      setNext("");
      setSource({ source: "app", changedAt: new Date().toISOString() });
      toast("Mot de passe changé", { description: "Les autres appareils ont été déconnectés." });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    lockVault();
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <>
      <PageHeader title="Réglages" />
      <div className="scroll-thin flex-1 overflow-y-auto p-7 max-md:p-4">
        <div className="mx-auto flex max-w-[560px] flex-col gap-4">
          <form onSubmit={change} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
            <div>
              <h2 className="text-[15px] font-medium">Mot de passe de l&apos;app</h2>
              <p className="mt-1 text-[13px] text-ink-3">
                {source?.source === "none"
                  ? "Aucun mot de passe : l'app est ouverte à quiconque connaît son adresse. Choisis-en un maintenant."
                  : source?.source === "env"
                    ? "C'est celui du fichier .env (APP_PASSWORD). Change-le ici pour le remplacer."
                    : "Il protège l'accès aux notes. Le coffre a son propre mot de passe maître."}
              </p>
            </div>
            {source?.source !== "none" && (
              <Field label="Mot de passe actuel">
                <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
              </Field>
            )}
            <Field label="Nouveau mot de passe" hint="Au moins 10 caractères.">
              <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
            </Field>
            <Button variant="primary" className="self-start" disabled={busy || next.length < 10 || (source?.source !== "none" && !current)}>
              {busy ? "Enregistrement…" : "Changer le mot de passe"}
            </Button>
          </form>

          {source && <SecuritySettings passwordRequired={source.source !== "none"} />}

          <AiSettings />

          <ImportNotes />

          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-medium">Session</h2>
              <p className="mt-1 text-[13px] text-ink-3">Se déconnecter verrouille aussi le coffre sur cet appareil.</p>
            </div>
            <Button onClick={logout}>
              <LogOut className="size-4" />
              Se déconnecter
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
