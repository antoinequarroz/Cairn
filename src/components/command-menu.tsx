"use client";

import { Command } from "cmdk";
import { BookOpenText, FileText, Folder as FolderIcon, FolderPlus, Import, KeyRound, Loader2, Lock, MessageSquarePlus, MessagesSquare, Plus, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { flattenFolders, folderPath, folderScope, useNotes } from "@/lib/notes-store";
import type { SearchResult } from "@/lib/types";
import { api, when } from "@/lib/utils";
import { lockVault } from "@/lib/vault-store";

/** Below this many characters, the menu lists recent items instead of searching the content. */
const MIN_SEARCH = 2;

/** Lowercase, without accents: "Élève" and "eleve" compare equal. */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

export function CommandMenu() {
  const { notes, folders, conversations, commandOpen: open, setCommandOpen: setOpen, newNote, newConversation, newFolder } = useNotes();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [folderId, setFolderId] = useState("");
  const [found, setFound] = useState<{ key: string; results: SearchResult[] } | null>(null);

  const q = search.trim();
  const searching = q.length >= MIN_SEARCH;
  const key = `${folderId}\n${q}`;

  // The content is searched on the server (full-text index), a moment after the last key pressed.
  useEffect(() => {
    if (!open || !searching) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q });
      if (folderId) params.set("folder", folderId);
      api<{ results: SearchResult[] }>(`/api/search?${params}`, { signal: ctrl.signal }).then(
        (r) => setFound({ key, results: r.results }),
        () => {},
      );
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, searching, q, folderId, key]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const scope = useMemo(() => (folderId ? folderScope(folders, folderId) : null), [folders, folderId]);
  const inScope = (id: string | null) => !scope || (id !== null && scope.has(id));
  const words = fold(q).split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every((w) => fold(text).includes(w));

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const actions = [
    { label: "Nouvelle note", icon: <Plus className="size-4" />, hint: "N", run: () => newNote(folderId || null) },
    { label: "Nouvelle discussion avec l'IA", icon: <MessageSquarePlus className="size-4" />, run: () => newConversation(folderId || null) },
    {
      label: folderId ? "Interroger les notes de ce dossier avec l'IA" : "Interroger toutes mes notes avec l'IA",
      icon: <BookOpenText className="size-4" />,
      run: () => newConversation(folderId || null, undefined, { folderId: folderId || null }),
    },
    { label: "Nouveau projet", icon: <FolderPlus className="size-4" />, run: () => newFolder() },
    { label: "Importer des notes (Notion, Markdown)", icon: <Import className="size-4" />, run: () => router.push("/settings#import") },
    { label: "Importer des mots de passe (1Password, Bitwarden, NordPass)", icon: <Import className="size-4" />, run: () => router.push("/vault#import") },
    { label: "Ouvrir le coffre", icon: <KeyRound className="size-4" />, run: () => router.push("/vault") },
    { label: "Verrouiller le coffre", icon: <Lock className="size-4" />, run: lockVault },
    { label: "Réglages", icon: <Settings className="size-4" />, run: () => router.push("/settings") },
  ].filter((a) => matches(a.label));
  const shownFolders = folders.filter((f) => inScope(f.id) && matches(`dossier ${folderPath(folders, f.id)}`)).slice(0, searching ? 6 : undefined);
  const recentConversations = searching ? [] : conversations.filter((c) => inScope(c.folderId) && matches(c.title)).slice(0, 8);
  const recentNotes = searching ? [] : notes.filter((n) => inScope(n.folderId) && matches(n.title));
  const results = found?.key === key ? found.results : (found?.results ?? []);
  const loading = searching && found?.key !== key;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Recherche"
      // Filtering and ranking are done here and on the server: cmdk only handles the keyboard.
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-40 bg-[rgba(15,14,12,0.3)] backdrop-blur-[2px]"
      contentClassName="fixed top-[16vh] left-1/2 z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]"
    >
      <div className="flex items-center gap-2 border-b border-line pr-2">
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Rechercher dans les notes et les discussions…"
          className="h-12 min-w-0 flex-1 bg-transparent px-4 text-[14.5px] outline-none placeholder:text-ink-3"
        />
        {loading && <Loader2 className="size-4 shrink-0 animate-spin text-ink-3" />}
        {folders.length > 0 && (
          <select
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            aria-label="Chercher dans"
            className="h-7 max-w-[40%] shrink-0 truncate rounded-md border border-line-strong bg-surface-2 px-1.5 text-[12px] text-ink-2 outline-none"
          >
            <option value="">Partout</option>
            {flattenFolders(folders).map(({ folder, depth }) => (
              <option key={folder.id} value={folder.id}>
                {"  ".repeat(depth)}
                {folder.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <Command.List className="scroll-thin max-h-[420px] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
        {!loading && <Command.Empty className="py-10 text-center text-[13px] text-ink-3">Aucun résultat.</Command.Empty>}

        {searching && results.length > 0 && (
          <Command.Group heading={folderId ? `Dans ${folderPath(folders, folderId)}` : "Notes et discussions"}>
            {results.map((r) => (
              <Command.Item
                key={`${r.kind}-${r.id}`}
                value={`${r.kind}-${r.id}`}
                onSelect={() => run(() => router.push(r.kind === "note" ? `/notes/${r.id}` : `/chat/${r.id}`))}
                className="flex cursor-default items-start gap-2.5 rounded-lg px-2 py-2 text-[13.5px] text-ink-2 data-[selected=true]:bg-ink/[0.05] data-[selected=true]:text-ink"
              >
                <span className="mt-0.5 text-ink-3">
                  {r.kind === "conversation" ? <MessagesSquare className="size-4" /> : r.encrypted ? <Lock className="size-4" /> : <FileText className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      <Highlighted text={r.title} fallback={r.kind === "note" ? "Sans titre" : "Nouvelle discussion"} />
                    </span>
                    <span className="shrink-0 text-[11.5px] text-ink-3">{when(r.updatedAt)}</span>
                  </span>
                  {(r.snippet || r.folderId || r.encrypted) && (
                    <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-ink-3">
                      {r.folderId && !folderId && <span className="mr-1.5 text-ink-3/80">{folderPath(folders, r.folderId)} ·</span>}
                      {r.encrypted ? "Note chiffrée : seul son titre est cherché." : <Highlighted text={r.snippet} />}
                    </span>
                  )}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {actions.length > 0 && (
          <Command.Group heading="Actions">
            {actions.map((a) => (
              <Item key={a.label} value={`action ${a.label}`} onSelect={() => run(a.run)} icon={a.icon} hint={a.hint}>
                {a.label}
              </Item>
            ))}
          </Command.Group>
        )}

        {shownFolders.length > 0 && (
          <Command.Group heading="Dossiers">
            {shownFolders.map((f) => (
              <Item key={f.id} value={`dossier ${f.id}`} onSelect={() => run(() => router.push(`/folders/${f.id}`))} icon={<FolderIcon className="size-4" />}>
                <span className="min-w-0 flex-1 truncate">{folderPath(folders, f.id)}</span>
              </Item>
            ))}
          </Command.Group>
        )}

        {recentConversations.length > 0 && (
          <Command.Group heading="Discussions">
            {recentConversations.map((c) => (
              <Item key={c.id} value={`discussion ${c.id}`} onSelect={() => run(() => router.push(`/chat/${c.id}`))} icon={<MessagesSquare className="size-4" />}>
                <span className="min-w-0 flex-1 truncate">{c.title || "Nouvelle discussion"}</span>
                <span className="shrink-0 text-[11.5px] text-ink-3">{when(c.updatedAt)}</span>
              </Item>
            ))}
          </Command.Group>
        )}

        {recentNotes.length > 0 && (
          <Command.Group heading="Notes">
            {recentNotes.map((n) => (
              <Item key={n.id} value={`note ${n.id}`} onSelect={() => run(() => router.push(`/notes/${n.id}`))} icon={n.encrypted ? <Lock className="size-4" /> : <FileText className="size-4" />}>
                <span className="min-w-0 flex-1 truncate">{n.title || "Sans titre"}</span>
                <span className="shrink-0 text-[11.5px] text-ink-3">{when(n.updatedAt)}</span>
              </Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

/** Text from the search, its matched words (between \u0001 and \u0002) highlighted. Never parsed as HTML. */
function Highlighted({ text, fallback = "" }: { text: string; fallback?: string }) {
  if (!text) return <>{fallback}</>;
  return (
    <>
      {text.split("\u0001").map((part, i) => {
        if (i === 0) return part.replace(/\u0002/g, "");
        const [hit, ...rest] = part.split("\u0002");
        return (
          <span key={i}>
            <mark className="rounded-[3px] bg-accent-soft px-px text-ink">{hit}</mark>
            {rest.join("")}
          </span>
        );
      })}
    </>
  );
}

function Item({ children, icon, hint, onSelect, value }: { children: React.ReactNode; icon: React.ReactNode; hint?: string; onSelect: () => void; value?: string }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2 text-[13.5px] text-ink-2 data-[selected=true]:bg-ink/[0.05] data-[selected=true]:text-ink">
      <span className="text-ink-3">{icon}</span>
      {children}
      {hint && <span className="ml-auto font-mono text-[11px] text-ink-3">{hint}</span>}
    </Command.Item>
  );
}
