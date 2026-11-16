"use client";

// The unlocked vault key lives only in this tab's memory: a reload, or 10 minutes without
// activity, locks the vault again. It is never written to storage nor sent to the server.
import { useSyncExternalStore } from "react";
import { createVault, unlockVault } from "./crypto";
import type { VaultMeta } from "./types";
import { api } from "./utils";

const AUTO_LOCK_MS = 10 * 60_000;

let key: CryptoKey | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function lockVault() {
  key = null;
  clearTimeout(timer);
  emit();
}

/** Restarts the auto-lock countdown. Called on every use of the key. */
function touch() {
  clearTimeout(timer);
  timer = setTimeout(lockVault, AUTO_LOCK_MS);
}

function setKey(k: CryptoKey) {
  key = k;
  touch();
  emit();
}

export function vaultKey() {
  if (key) touch();
  return key;
}

export async function setupVault(password: string): Promise<VaultMeta> {
  const { meta, key: k } = await createVault(password);
  await api("/api/vault", { method: "POST", json: { meta } });
  setKey(k);
  return meta;
}

export async function unlock(password: string, meta?: VaultMeta | null) {
  const m = meta ?? (await api<{ meta: VaultMeta | null }>("/api/vault")).meta;
  if (!m) throw new Error("Le coffre n'existe pas encore. Crée-le depuis la page Coffre.");
  setKey(await unlockVault(password, m));
}

export function useVaultKey() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => key,
    () => null,
  );
}
