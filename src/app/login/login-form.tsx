"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui";

const input =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] outline-none focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]";

/** `lamio`: the suite's messaging app can vouch for the person (see src/server/lamio.ts). */
export function LoginForm({ lamio }: { lamio: boolean }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // Second step: the password was right and two-factor is on. The password is sent again with the code.
  const [needCode, setNeedCode] = useState(false);
  const [recovery, setRecovery] = useState(false);
  // Lamio vouched for the person in place of the password: only the code is left to give.
  const [viaLamio, setViaLamio] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const back = new URLSearchParams(window.location.search).get("lamio");
    if (back === "code") {
      setViaLamio(true);
      setNeedCode(true);
    }
    // Back from Lamio without a way in: not signed in there, not allowed, or the link expired.
    if (back === "refus") setError("Lamio n'a pas ouvert l'accès. Réessaie, ou entre le mot de passe.");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(viaLamio ? { code } : needCode ? { password, code } : { password }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; needCode?: boolean; };
    if (res.ok) {
      window.location.href = "/notes";
      return;
    }
    if (data.needCode && !needCode) {
      setNeedCode(true);
    } else {
      setError(data.error ?? "Connexion impossible");
      if (needCode) setCode("");
    }
    setBusy(false);
  };

  const back = () => {
    setNeedCode(false);
    setViaLamio(false);
    setRecovery(false);
    setCode("");
    setError("");
  };

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="rise w-full max-w-[360px] rounded-2xl border border-line bg-surface/80 p-7 shadow-card backdrop-blur-xl">
        <Logo className="size-9" />
        <h1 className="mt-5 font-display text-[30px] leading-none">Cairn</h1>
        {!needCode ? (
          <>
            <p className="mt-2 text-[13px] text-ink-3">Entre ton mot de passe pour ouvrir tes notes.</p>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mot de passe"
              className={`mt-6 ${input}`}
            />
          </>
        ) : (
          <>
            <p className="mt-2 text-[13px] text-ink-3">
              {recovery ? "Entre un de tes codes de secours. Il ne servira qu'une fois." : "Entre le code à 6 chiffres de ton app d'authentification."}
            </p>
            <input
              key={recovery ? "recovery" : "totp"}
              autoFocus
              autoComplete="one-time-code"
              inputMode={recovery ? "text" : "numeric"}
              pattern={recovery ? undefined : "[0-9 ]*"}
              maxLength={recovery ? 20 : 7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={recovery ? "xxxxx-xxxxx" : "123 456"}
              className={`mt-6 ${input} font-mono tracking-[0.2em]`}
            />
          </>
        )}
        {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
        <Button variant="primary" className="mt-4 w-full" disabled={busy || (needCode ? !code.trim() : !password)}>
          {busy ? "Connexion…" : needCode ? "Valider" : "Se connecter"}
        </Button>
        {needCode && (
          <div className="mt-3 flex justify-between text-[12.5px]">
            <button type="button" onClick={back} className="text-ink-3 hover:text-ink">
              Retour
            </button>
            <button
              type="button"
              onClick={() => {
                setRecovery(!recovery);
                setCode("");
                setError("");
              }}
              className="text-accent hover:underline"
            >
              {recovery ? "Utiliser l'app" : "Téléphone perdu ?"}
            </button>
          </div>
        )}
        {lamio && !needCode && (
          <>
            <div className="my-4 flex items-center gap-3 text-[12px] text-ink-3">
              <span className="h-px flex-1 bg-line" />
              ou
              <span className="h-px flex-1 bg-line" />
            </div>
            <a href="/api/auth/lamio/start" className="press flex h-9 w-full items-center justify-center rounded-lg border border-line-strong bg-surface text-[13.5px] font-medium text-ink hover:bg-surface-2">
              Se connecter avec Lamio
            </a>
          </>
        )}
      </form>
    </div>
  );
}
