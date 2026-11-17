"use client";

import { Command } from "cmdk";
import { FileText, Folder as FolderIcon, FolderPlus, KeyRound, Lock, MessageSquarePlus, MessagesSquare, Plus, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { folderPath, useNotes } from "@/lib/notes-store";
import { lockVault } from "@/lib/vault-store";
import { when } from "@/lib/utils";

export function CommandMenu() {
  const { notes, folders, conversations, commandOpen: open, setCommandOpen: setOpen, newNote, newConversation, newFolder } = useNotes();
  const router = useRouter();

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Recherche"
      overlayClassName="fixed inset-0 z-40 bg-[rgba(15,14,12,0.3)] backdrop-blur-[2px]"
      contentClassName="fixed top-[16vh] left-1/2 z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]"
    >
      <Command.Input placeholder="Rechercher une note, une action…" className="h-12 w-full border-b border-line bg-transparent px-4 text-[14.5px] outline-none placeholder:text-ink-3" />
      <Command.List className="scroll-thin max-h-[380px] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
        <Command.Empty className="py-10 text-center text-[13px] text-ink-3">Aucun résultat.</Command.Empty>
        <Command.Group heading="Actions">
          <Item onSelect={() => run(() => newNote())} icon={<Plus className="size-4" />} hint="N">
            Nouvelle note
          </Item>
          <Item onSelect={() => run(() => newConversation())} icon={<MessageSquarePlus className="size-4" />}>
            Nouvelle discussion avec l&apos;IA
          </Item>
          <Item onSelect={() => run(() => newFolder())} icon={<FolderPlus className="size-4" />}>
            Nouveau projet
          </Item>
          <Item onSelect={() => run(() => router.push("/vault"))} icon={<KeyRound className="size-4" />}>
            Ouvrir le coffre
          </Item>
          <Item onSelect={() => run(lockVault)} icon={<Lock className="size-4" />}>
            Verrouiller le coffre
          </Item>
          <Item onSelect={() => run(() => router.push("/settings"))} icon={<Settings className="size-4" />}>
            Réglages
          </Item>
        </Command.Group>
        {folders.length > 0 && (
          <Command.Group heading="Dossiers">
            {folders.map((f) => (
              <Item key={f.id} value={`dossier ${folderPath(folders, f.id)} ${f.id}`} onSelect={() => run(() => router.push(`/folders/${f.id}`))} icon={<FolderIcon className="size-4" />}>
                <span className="min-w-0 flex-1 truncate">{folderPath(folders, f.id)}</span>
              </Item>
            ))}
          </Command.Group>
        )}
        {conversations.length > 0 && (
          <Command.Group heading="Discussions">
            {conversations.map((c) => (
              <Item key={c.id} value={`discussion ${c.title} ${c.id}`} onSelect={() => run(() => router.push(`/chat/${c.id}`))} icon={<MessagesSquare className="size-4" />}>
                <span className="min-w-0 flex-1 truncate">{c.title || "Nouvelle discussion"}</span>
                <span className="shrink-0 text-[11.5px] text-ink-3">{when(c.updatedAt)}</span>
              </Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="Notes">
          {notes.map((n) => (
            <Item key={n.id} value={`${n.title} ${n.excerpt} ${n.id}`} onSelect={() => run(() => router.push(`/notes/${n.id}`))} icon={n.encrypted ? <Lock className="size-4" /> : <FileText className="size-4" />}>
              <span className="min-w-0 flex-1 truncate">{n.title || "Sans titre"}</span>
              <span className="shrink-0 text-[11.5px] text-ink-3">{when(n.updatedAt)}</span>
            </Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
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
