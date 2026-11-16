"use client";

import type { FileInfo } from "./types";
import { api } from "./utils";

type Step = { received?: number; file?: FileInfo; url?: string; error?: string };

/** Sends a file in chunks (the server cuts bigger bodies) and returns where it now lives. */
export async function uploadFile(file: File): Promise<{ file: FileInfo; url: string }> {
  const { id, chunk } = await api<{ id: string; chunk: number }>("/api/files", { method: "POST", json: { name: file.name, mime: file.type, size: file.size } });
  let offset = 0;
  let tries = 0;
  for (;;) {
    const res = await fetch(`/api/uploads/${id}?offset=${offset}`, { method: "PUT", body: file.slice(offset, offset + chunk) }).catch(() => undefined);
    const step = res ? ((await res.json().catch(() => ({}))) as Step) : {};
    if (res?.ok && step.file && step.url) return { file: step.file, url: step.url };
    if (res?.ok && step.received !== undefined) {
      offset = step.received;
      tries = 0;
    } else if (res?.status === 409 && step.received !== undefined) {
      // The answer to a chunk was lost: carry on from where the server stands.
      offset = step.received;
    } else if (res && res.status < 500) {
      throw new Error(step.error ?? `Erreur ${res.status}`);
    }
    if (!res?.ok) {
      if (++tries > 4) throw new Error(step.error ?? "Connexion perdue pendant l'envoi");
      await new Promise((r) => setTimeout(r, 500 * 2 ** tries));
    }
  }
}
