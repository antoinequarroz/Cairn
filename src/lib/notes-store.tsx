"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Conversation, ConversationSummary, Folder, Note, NoteSummary } from "./types";
import { api } from "./utils";

/** What can be filed in a folder. */
export type ItemKind = "note" | "conversation" | "folder";

type Store = {
  notes: NoteSummary[];
  folders: Folder[];
  conversations: ConversationSummary[];
  loaded: boolean;
  error: string;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  reload: () => Promise<void>;
  /** Creates an empty note, in a folder or at the root, and opens it. */
  newNote: (folderId?: string | null) => Promise<void>;
  /** Creates a discussion with the AI and opens it. */
  newConversation: (folderId?: string | null, contextNoteIds?: string[]) => Promise<void>;
  /** Creates a folder and opens it, its name ready to be typed. */
  newFolder: (parentId?: string | null) => Promise<void>;
  /** Mirrors a saved note in the sidebar without a round trip. */
  touch: (note: Note) => void;
  remove: (id: string) => void;
  touchConversation: (conversation: ConversationSummary | Conversation) => void;
  removeConversation: (id: string) => void;
  touchFolder: (folder: Folder) => void;
  /** Deletes a folder. What it holds moves up to its parent, on the server and here. */
  deleteFolder: (id: string) => Promise<boolean>;
  /** Files a note, a discussion or a folder somewhere else. `null` is the root. */
  move: (kind: ItemKind, id: string, folderId: string | null) => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

const summary = (note: Note): NoteSummary => ({
  id: note.id,
  title: note.title,
  encrypted: note.encrypted,
  folderId: note.folderId,
  updatedAt: note.updatedAt,
  excerpt: note.encrypted ? "" : note.content.replace(/\s+/g, " ").trim().slice(0, 160),
});

const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" });

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [n, f, c] = await Promise.all([
        api<{ notes: NoteSummary[] }>("/api/notes"),
        api<{ folders: Folder[] }>("/api/folders"),
        api<{ conversations: ConversationSummary[] }>("/api/conversations"),
      ]);
      setNotes(n.notes);
      setFolders(f.folders);
      setConversations(c.conversations);
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

  const touchConversation = useCallback(
    (c: ConversationSummary | Conversation) =>
      setConversations((list) => [{ id: c.id, folderId: c.folderId, title: c.title, updatedAt: c.updatedAt }, ...list.filter((x) => x.id !== c.id)]),
    [],
  );
  const touchFolder = useCallback((f: Folder) => setFolders((list) => [...list.filter((x) => x.id !== f.id), f].sort(byName)), []);

  const store = useMemo<Store>(
    () => ({
      notes,
      folders,
      conversations,
      loaded,
      error,
      commandOpen,
      setCommandOpen,
      reload,
      newNote: async (folderId = null) => {
        try {
          const { note } = await api<{ note: Note }>("/api/notes", { method: "POST", json: { folderId } });
          setNotes((n) => [summary(note), ...n]);
          router.push(`/notes/${note.id}`);
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
      newConversation: async (folderId = null, contextNoteIds) => {
        try {
          const { conversation } = await api<{ conversation: Conversation }>("/api/conversations", { method: "POST", json: { folderId, contextNoteIds } });
          touchConversation(conversation);
          router.push(`/chat/${conversation.id}`);
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
      newFolder: async (parentId = null) => {
        try {
          const { folder } = await api<{ folder: Folder }>("/api/folders", { method: "POST", json: { name: "Nouveau dossier", parentId } });
          touchFolder(folder);
          router.push(`/folders/${folder.id}?new=1`);
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
      touch: (note) => setNotes((n) => [summary(note), ...n.filter((x) => x.id !== note.id)]),
      remove: (id) => setNotes((n) => n.filter((x) => x.id !== id)),
      touchConversation,
      removeConversation: (id) => setConversations((list) => list.filter((x) => x.id !== id)),
      touchFolder,
      deleteFolder: async (id) => {
        try {
          await api(`/api/folders/${id}`, { method: "DELETE" });
          // Its notes, discussions and subfolders moved up: take the server's word for where they are now.
          await reload();
          return true;
        } catch (e) {
          toast.error((e as Error).message);
          return false;
        }
      },
      move: async (kind, id, folderId) => {
        try {
          if (kind === "note") {
            const { note } = await api<{ note: Note }>(`/api/notes/${id}`, { method: "PATCH", json: { folderId } });
            setNotes((n) => n.map((x) => (x.id === id ? { ...x, folderId: note.folderId } : x)));
          } else if (kind === "conversation") {
            const { conversation } = await api<{ conversation: Conversation }>(`/api/conversations/${id}`, { method: "PATCH", json: { folderId } });
            setConversations((list) => list.map((x) => (x.id === id ? { ...x, folderId: conversation.folderId } : x)));
          } else {
            const { folder } = await api<{ folder: Folder }>(`/api/folders/${id}`, { method: "PATCH", json: { parentId: folderId } });
            touchFolder(folder);
          }
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    }),
    [notes, folders, conversations, loaded, error, commandOpen, reload, router, touchConversation, touchFolder],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useNotes() {
  const store = useContext(Ctx);
  if (!store) throw new Error("NotesProvider manquant");
  return store;
}

/** "Projet / Sous-dossier", for a folder id. */
export function folderPath(folders: Folder[], id: string | null): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let f = folders.find((x) => x.id === id); f && !seen.has(f.id); f = folders.find((x) => x.id === f!.parentId)) {
    seen.add(f.id);
    names.unshift(f.name);
  }
  return names.join(" / ");
}

/** Every folder, depth first, with its depth: for a list of choices that shows the tree. */
export function flattenFolders(folders: Folder[]): { folder: Folder; depth: number }[] {
  const out: { folder: Folder; depth: number }[] = [];
  const ids = new Set(folders.map((f) => f.id));
  const visit = (parentId: string | null, depth: number) => {
    for (const f of folders.filter((x) => x.parentId === parentId || (parentId === null && x.parentId !== null && !ids.has(x.parentId)))) {
      if (out.some((o) => o.folder.id === f.id)) continue;
      out.push({ folder: f, depth });
      visit(f.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}
