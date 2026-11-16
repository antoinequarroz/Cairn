"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Note, NoteSummary } from "./types";
import { api } from "./utils";

type Store = {
  notes: NoteSummary[];
  loaded: boolean;
  error: string;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  reload: () => Promise<void>;
  /** Creates an empty note and opens it. */
  newNote: () => Promise<void>;
  /** Mirrors a saved note in the sidebar without a round trip. */
  touch: (note: Note) => void;
  remove: (id: string) => void;
};

const Ctx = createContext<Store | null>(null);

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      setNotes((await api<{ notes: NoteSummary[] }>("/api/notes")).notes);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
    // Notes written on another device show up when coming back to the tab.
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const store = useMemo<Store>(
    () => ({
      notes,
      loaded,
      error,
      commandOpen,
      setCommandOpen,
      reload,
      newNote: async () => {
        try {
          const { note } = await api<{ note: Note }>("/api/notes", { method: "POST", json: {} });
          setNotes((n) => [{ id: note.id, title: "", encrypted: false, updatedAt: note.updatedAt, excerpt: "" }, ...n]);
          router.push(`/notes/${note.id}`);
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
      touch: (note) =>
        setNotes((n) => [
          { id: note.id, title: note.title, encrypted: note.encrypted, updatedAt: note.updatedAt, excerpt: note.encrypted ? "" : note.content.replace(/\s+/g, " ").trim().slice(0, 160) },
          ...n.filter((x) => x.id !== note.id),
        ]),
      remove: (id) => setNotes((n) => n.filter((x) => x.id !== id)),
    }),
    [notes, loaded, error, commandOpen, reload, router],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useNotes() {
  const store = useContext(Ctx);
  if (!store) throw new Error("NotesProvider manquant");
  return store;
}
