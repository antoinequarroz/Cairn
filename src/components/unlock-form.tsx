"use client";

import { useState } from "react";
import type { VaultMeta } from "@/lib/types";
import { unlock } from "@/lib/vault-store";
import { Button, inputClass } from "./ui";

/** Asks for the master password and unlocks the vault for this tab. */
export function UnlockForm({ meta }: { meta?: VaultMeta | null }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await unlock(password, meta);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input type="password" autoFocus autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe maître" aria-label="Mot de passe maître" className={inputClass} />
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <Button variant="primary" disabled={busy || !password}>
        {busy ? "Déverrouillage…" : "Déverrouiller"}
      </Button>
    </form>
  );
}
