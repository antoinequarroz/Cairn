"use client";

import { MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";
import { Button, PageHeader } from "@/components/ui";
import { folderPath, useNotes } from "@/lib/notes-store";
import { when } from "@/lib/utils";

export default function ChatsPage() {
  const { conversations, folders, newConversation } = useNotes();
  return (
    <>
      <PageHeader title="Discussions" subtitle={conversations.length ? "Avec l'IA, rangées dans tes projets" : "Discute avec l'IA, avec tes notes en contexte."}>
        <Button variant="primary" onClick={() => newConversation()}>
          <Plus className="size-4" strokeWidth={2.4} />
          <span className="max-md:hidden">Nouvelle discussion</span>
        </Button>
      </PageHeader>
      {conversations.length ? (
        <div className="scroll-thin flex flex-1 flex-col gap-1 overflow-y-auto p-5 max-md:p-3">
          {conversations.map((c) => (
            <Link key={c.id} href={`/chat/${c.id}`} className="press flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-ink/[0.04]">
              <MessagesSquare className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className={c.title ? "block truncate text-[14px]" : "block truncate text-[14px] text-ink-3"}>{c.title || "Nouvelle discussion"}</span>
                <span className="block truncate text-[12px] text-ink-3">{folderPath(folders, c.folderId) || "Sans dossier"}</span>
              </span>
              <span className="shrink-0 text-[12px] text-ink-3">{when(c.updatedAt)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="font-display text-[26px] leading-none">Aucune discussion pour l&apos;instant</p>
          <p className="max-w-[400px] text-[13.5px] text-ink-3">Une discussion se range dans un projet comme une note. L&apos;IA y lit les consignes du projet et les notes que tu épingles.</p>
          <Button variant="primary" className="mt-2" onClick={() => newConversation()}>
            <Plus className="size-4" strokeWidth={2.4} />
            Nouvelle discussion
          </Button>
        </div>
      )}
    </>
  );
}
