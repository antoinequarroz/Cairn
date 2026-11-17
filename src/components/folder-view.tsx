"use client";

import { ChevronRight, FilePlus2, FileText, Folder as FolderIcon, FolderPlus, Lock, MessageSquarePlus, MessagesSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MAX_FOLDER_INSTRUCTIONS } from "@/lib/chat";
import { useNotes } from "@/lib/notes-store";
import type { Folder } from "@/lib/types";
import { api, cn, when } from "@/lib/utils";
import { FolderSelect } from "./folder-select";
import { Button } from "./ui";

/** A folder: its name, the AI instructions of the project, and what it holds. */
export function FolderView({ id }: { id: string }) {
  const router = useRouter();
  const { folders, notes, conversations, touchFolder, deleteFolder, newNote, newConversation, newFolder, move } = useNotes();
  const folder = folders.find((f) => f.id === id);
  const [name, setName] = useState(folder?.name ?? "");
  const [instructions, setInstructions] = useState(folder?.instructions ?? "");
  const [saving, setSaving] = useState<"saved" | "dirty" | "error">("saved");
  const nameInput = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<{ name?: string; instructions?: string }>({});
  const ready = useRef(false);

  // The store may load after this page: take the folder's values once, when it shows up.
  useEffect(() => {
    if (!folder || ready.current) return;
    ready.current = true;
    setName(folder.name);
    setInstructions(folder.instructions);
    if (new URLSearchParams(window.location.search).get("new")) {
      nameInput.current?.focus();
      nameInput.current?.select();
      router.replace(`/folders/${id}`);
    }
  }, [folder, id, router]);

  const flush = async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    try {
      const { folder: saved } = await api<{ folder: Folder }>(`/api/folders/${id}`, { method: "PATCH", json: patch });
      touchFolder(saved);
      setSaving(Object.keys(pending.current).length ? "dirty" : "saved");
    } catch (e) {
      setSaving("error");
      toast.error((e as Error).message, { id: "folder-save" });
    }
  };
  const change = (patch: { name?: string; instructions?: string }) => {
    Object.assign(pending.current, patch);
    setSaving("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };
  // Leaving with unsaved changes: save them now.
  useEffect(
    () => () => {
      if (timer.current) flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!folder)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-[15px] font-medium">Ce dossier n&apos;existe plus</p>
        <Link href="/notes" className="text-[13px] text-accent">
          Revenir aux notes
        </Link>
      </div>
    );

  const chain: Folder[] = [];
  for (let f = folders.find((x) => x.id === folder.parentId); f && !chain.includes(f); f = folders.find((x) => x.id === f!.parentId)) chain.unshift(f);
  const subfolders = folders.filter((f) => f.parentId === id);
  const items = [
    ...conversations.filter((c) => c.folderId === id).map((c) => ({ kind: "conversation" as const, id: c.id, title: c.title, updatedAt: c.updatedAt, encrypted: false, excerpt: "" })),
    ...notes.filter((n) => n.folderId === id).map((n) => ({ kind: "note" as const, id: n.id, title: n.title, updatedAt: n.updatedAt, encrypted: n.encrypted, excerpt: n.excerpt })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const del = async () => {
    const count = subfolders.length + items.length;
    const message = count
      ? `Supprimer le dossier « ${folder.name} » ? Ses ${count} élément${count > 1 ? "s" : ""} (notes, discussions, sous-dossiers) ne sont pas supprimés : ils remontent dans ${chain.length ? `« ${chain.at(-1)!.name} »` : "Sans dossier"}.`
      : `Supprimer le dossier « ${folder.name} » ?`;
    if (!window.confirm(message)) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    if (await deleteFolder(id)) router.push(folder.parentId ? `/folders/${folder.parentId}` : "/notes");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-5 py-2.5 max-md:px-3">
        <nav className="flex min-w-0 items-center gap-1 text-[12.5px] text-ink-3" aria-label="Chemin">
          {chain.map((f) => (
            <span key={f.id} className="flex min-w-0 items-center gap-1">
              <Link href={`/folders/${f.id}`} className="truncate hover:text-ink">
                {f.name}
              </Link>
              <ChevronRight className="size-3 shrink-0" />
            </span>
          ))}
          <span className="truncate text-ink-2">{folder.name}</span>
        </nav>
        <span className={cn("ml-2 text-[12px] max-md:hidden", saving === "error" ? "text-danger" : "text-ink-3")} aria-live="polite">
          {saving === "saved" ? "" : saving === "error" ? "Non enregistré" : "Enregistrement…"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <FolderSelect value={folder.parentId} exclude={id} onChange={(parentId) => move("folder", id, parentId)} label="Ranger ce dossier dans" className="max-w-[200px]" />
          <Button size="sm" variant="ghost" onClick={del} aria-label="Supprimer le dossier" title="Supprimer le dossier">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-3 px-7 pt-6 max-md:px-4">
          <FolderIcon className="size-7 shrink-0 text-accent" />
          <input
            ref={nameInput}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value.trim()) change({ name: e.target.value.trim() });
            }}
            onBlur={() => !name.trim() && setName(folder.name)}
            placeholder="Nom du dossier"
            aria-label="Nom du dossier"
            className="min-w-0 flex-1 bg-transparent font-display text-[34px] leading-tight outline-none placeholder:text-ink-3 max-md:text-[28px]"
          />
        </div>

        <div className="flex flex-wrap gap-2 px-7 pt-4 max-md:px-4">
          <Button size="sm" variant="secondary" onClick={() => newNote(id)}>
            <FilePlus2 className="size-3.5" />
            Nouvelle note
          </Button>
          <Button size="sm" variant="secondary" onClick={() => newConversation(id)}>
            <MessageSquarePlus className="size-3.5" />
            Nouvelle discussion
          </Button>
          <Button size="sm" variant="ghost" onClick={() => newFolder(id)}>
            <FolderPlus className="size-3.5" />
            Sous-dossier
          </Button>
        </div>

        <section className="px-7 pt-6 max-md:px-4">
          <label htmlFor="folder-instructions" className="text-[12px] font-medium text-ink-2">
            Consignes pour l&apos;IA
          </label>
          <p className="mt-0.5 mb-2 text-[12px] text-ink-3">
            Lues au début de chaque discussion de ce dossier{subfolders.length ? " et de ses sous-dossiers" : ""}
            {chain.some((f) => f.instructions.trim()) ? ", après celles des dossiers parents" : ""}. Par exemple : « Ce projet parle de mon VPS Debian. Réponds en français, avec les commandes à taper. »
          </p>
          <textarea
            id="folder-instructions"
            value={instructions}
            maxLength={MAX_FOLDER_INSTRUCTIONS}
            onChange={(e) => {
              setInstructions(e.target.value);
              change({ instructions: e.target.value });
            }}
            rows={Math.min(12, Math.max(3, instructions.split("\n").length + 1))}
            placeholder="Aucune consigne"
            className="scroll-thin w-full resize-y rounded-xl border border-line-strong bg-surface px-3 py-2 text-[13.5px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </section>

        <section className="px-7 py-6 max-md:px-4">
          {subfolders.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {subfolders.map((f) => (
                <Link key={f.id} href={`/folders/${f.id}`} className="press flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] shadow-card hover:border-line-strong">
                  <FolderIcon className="size-3.5 text-ink-3" />
                  {f.name}
                </Link>
              ))}
            </div>
          )}
          {items.length ? (
            <div className="flex flex-col gap-px">
              {items.map((item) => (
                <Link key={`${item.kind}-${item.id}`} href={item.kind === "note" ? `/notes/${item.id}` : `/chat/${item.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-ink/[0.04]">
                  {item.kind === "conversation" ? <MessagesSquare className="size-4 shrink-0 text-accent" /> : item.encrypted ? <Lock className="size-4 shrink-0 text-accent" /> : <FileText className="size-4 shrink-0 text-ink-3" />}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[14px]", !item.title && "text-ink-3")}>{item.title || (item.kind === "note" ? "Sans titre" : "Nouvelle discussion")}</span>
                    {item.excerpt && <span className="block truncate text-[12px] text-ink-3">{item.excerpt}</span>}
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-3">{when(item.updatedAt)}</span>
                </Link>
              ))}
            </div>
          ) : (
            !subfolders.length && <p className="text-[13px] text-ink-3">Ce dossier est vide. Crée une note ou une discussion, ou glisse-en une sur ce dossier dans la barre latérale.</p>
          )}
        </section>
      </div>
    </div>
  );
}
