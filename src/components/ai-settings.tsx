"use client";

import { Check, ChevronRight, FlaskConical, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PROVIDER_NAMES, type ProviderId } from "@/lib/ai";
import type { AiProviderView, AiSettingsUpdate, AiSettingsView } from "@/lib/ai-settings";
import { api, cn } from "@/lib/utils";
import { Button, Field, inputClass } from "./ui";

type Copy = { intro: React.ReactNode; secret: string; secretHint?: string; models?: string[]; url?: string };

const COPY: Record<ProviderId, Copy> = {
  anthropic: {
    intro: <>Une clé d&apos;API de console.anthropic.com, facturée à l&apos;usage, à part de tout abonnement.</>,
    secret: "Clé d'API Anthropic",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  openai: {
    intro: <>Une clé d&apos;API OpenAI, ou tout serveur compatible (Ollama, LM Studio, OpenRouter) avec son adresse.</>,
    secret: "Clé d'API",
    url: "Adresse de l'API",
  },
  hermes: {
    intro: <>Ton agent Hermes sur le VPS, comme pour Metricove. La clé est son API_SERVER_KEY.</>,
    secret: "Clé Hermes",
    url: "Adresse de Hermes",
  },
};

const ORDER: ProviderId[] = ["anthropic", "openai", "hermes"];

export function AiSettings() {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api<AiSettingsView>("/api/settings/ai").then(setView, () => setError(true));
  }, []);

  const save = async (update: AiSettingsUpdate, done?: string) => {
    try {
      setView(await api<AiSettingsView>("/api/settings/ai", { method: "PUT", json: update }));
      if (done) toast(done);
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
      <div>
        <h2 className="flex items-center gap-1.5 text-[15px] font-medium">
          <Sparkles className="size-4 text-accent" />
          Intelligence artificielle
        </h2>
        <p className="mt-1 text-[13px] text-ink-3">
          {!view
            ? error
              ? "Impossible de lire les réglages de l'IA."
              : "Un instant…"
            : view.active.ready
              ? `Le bouton « IA » des notes utilise ${view.active.label}.`
              : view.active.provider
                ? `${PROVIDER_NAMES[view.active.provider]} est choisi, mais il lui manque sa clé.`
                : "Aucune IA n'est branchée. Ajoute une clé d'API ou Hermes ci-dessous."}{" "}
          Les clés restent chiffrées sur le serveur et ne reviennent jamais dans le navigateur. Les notes avec le cadenas ne sont jamais envoyées.
        </p>
      </div>

      {view && (
        <>
          <Field label="Fournisseur utilisé" hint={view.provider === null && view.envProvider ? `Pour l'instant, celui du .env (AI_PROVIDER=${view.envProvider}).` : undefined}>
            <select
              className={inputClass}
              value={view.provider ?? (view.envProvider ? "" : "auto")}
              onChange={(e) => void save({ provider: (e.target.value || null) as AiSettingsUpdate["provider"] }, "Fournisseur enregistré")}
            >
              {view.provider === null && view.envProvider && <option value="">Celui du .env ({view.envProvider})</option>}
              <option value="auto">Automatique (le premier branché)</option>
              {ORDER.map((id) => {
                const p = view.providers.find((x) => x.id === id)!;
                return (
                  <option key={id} value={id}>
                    {PROVIDER_NAMES[id]}
                    {p.configured ? "" : " (non branché)"}
                  </option>
                );
              })}
            </select>
          </Field>

          <div className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line">
            {ORDER.map((id) => (
              <ProviderRow key={id} p={view.providers.find((x) => x.id === id)!} active={view.active.provider === id && view.active.ready} save={save} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ProviderRow({ p, active, save }: { p: AiProviderView; active: boolean; save: (u: AiSettingsUpdate, done?: string) => Promise<boolean> }) {
  const copy = COPY[p.id];
  const [secret, setSecret] = useState("");
  const [model, setModel] = useState(p.model);
  const [url, setUrl] = useState(p.url ?? "");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const dirty = !!secret.trim() || model !== p.model || (p.url !== undefined && url !== p.url);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const change: { model?: string; url?: string; secret?: string } = { model };
    if (p.url !== undefined) change.url = url;
    if (secret.trim()) change.secret = secret;
    if (await save({ providers: { [p.id]: change } }, `${PROVIDER_NAMES[p.id]} enregistré`)) setSecret("");
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    await save({ providers: { [p.id]: { secret: null } } }, p.secretSource === "app" ? "Clé retirée de Cairn" : undefined);
    setBusy(false);
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api<{ answer: string; ms: number }>("/api/settings/ai/test", { method: "POST", json: { provider: p.id } });
      toast(`${PROVIDER_NAMES[p.id]} répond`, { description: `« ${r.answer} » (${(r.ms / 1000).toFixed(1)} s)` });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const status = p.unreadable
    ? { text: "Clé illisible", tone: "text-danger" }
    : active
      ? { text: "Utilisé", tone: "text-accent" }
      : p.configured
        ? { text: p.secretSource === "env" ? "Branché (.env)" : "Branché", tone: "text-ok" }
        : { text: "Non branché", tone: "text-ink-3" };

  return (
    <details className="group bg-surface open:bg-surface-2/50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-[13.5px] select-none hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 text-ink-3 transition-transform group-open:rotate-90" />
        <span className="flex-1 font-medium">{PROVIDER_NAMES[p.id]}</span>
        <span className={cn("inline-flex items-center gap-1 text-[12px]", status.tone)}>
          {active && <Check className="size-3.5" />}
          {status.text}
        </span>
      </summary>
      <form onSubmit={submit} className="flex flex-col gap-3 px-3.5 pt-1 pb-4">
        <p className="text-[12.5px] leading-relaxed text-ink-2">{copy.intro}</p>
        {p.unreadable && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-ink-2">
            La clé enregistrée ne peut plus être déchiffrée (CAIRN_SECRET a changé, ou data/secret.key a été perdu). Colle-la à nouveau.
          </p>
        )}
        {copy.url && (
          <Field label={copy.url} hint={p.urlFallback ? `Vide : ${p.urlFallback} (du .env)` : p.id === "openai" ? "Vide : https://api.openai.com/v1" : undefined}>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={p.urlFallback || (p.id === "hermes" ? "http://host.docker.internal:8642" : "https://api.openai.com/v1")} className={inputClass} spellCheck={false} />
          </Field>
        )}
        <Field
          label={copy.secret}
          hint={p.secretSource === "app" ? `Enregistrée${p.secretHint ? ` (${p.secretHint})` : ""}. Laisse vide pour la garder.` : p.secretSource === "env" ? `Celle du .env${p.secretHint ? ` (${p.secretHint})` : ""} est utilisée. Une valeur ici la remplace.` : copy.secretHint}
        >
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={p.secretSource ? "••••••••" : ""} className={inputClass} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Modèle" hint={`Vide : ${p.modelFallback}`}>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={p.modelFallback} list={copy.models ? `models-${p.id}` : undefined} className={inputClass} spellCheck={false} />
        </Field>
        {copy.models && (
          <datalist id={`models-${p.id}`}>
            {copy.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy || !dirty}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </Button>
          <Button type="button" onClick={test} disabled={testing || !p.configured || dirty} title={dirty ? "Enregistre d'abord" : undefined}>
            <FlaskConical className="size-4" />
            {testing ? "Test en cours…" : "Tester"}
          </Button>
          {(p.secretSource === "app" || p.unreadable) && (
            <Button type="button" variant="ghost" onClick={remove} disabled={busy} className="ml-auto text-danger">
              <Trash2 className="size-4" />
              Retirer
            </Button>
          )}
        </div>
      </form>
    </details>
  );
}
