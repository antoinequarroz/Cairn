"use client";

import { FileText, Lock, Plus } from "lucide-react";
import Link from "next/link";
import { Button, PageHeader } from "@/components/ui";
import { useNotes } from "@/lib/notes-store";
import { when } from "@/lib/utils";

export default function NotesPage() {
  const { notes, newNote } = useNotes();
  return (
    <>
      <PageHeader title="Notes" subtitle={notes.length ? `${notes.length} note${notes.length > 1 ? "s" : ""}, la plus récente en premier` : "Tout s'écrit en Markdown."}>
        <Button variant="primary" className="max-md:hidden" onClick={newNote}>
          <Plus className="size-4" strokeWidth={2.4} />
          Nouvelle note
        </Button>
      </PageHeader>
      {notes.length ? (
        <div className="scroll-thin grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 overflow-y-auto p-7 max-md:p-4">
          {notes.map((n, i) => (
            <Link
              key={n.id}
              href={`/notes/${n.id}`}
              style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
              className="rise press flex h-[132px] flex-col rounded-xl border border-line bg-surface p-4 shadow-card hover:border-line-strong"
            >
              <span className="flex items-center gap-2">
                {n.encrypted ? <Lock className="size-4 shrink-0 text-accent" /> : <FileText className="size-4 shrink-0 text-ink-3" />}
                <span className="truncate text-[14px] font-medium">{n.title || "Sans titre"}</span>
              </span>
              <span className="mt-2 line-clamp-3 flex-1 text-[12.5px] leading-snug text-ink-2">{n.encrypted ? "Chiffrée de bout en bout. Ouvre le coffre pour la lire." : n.excerpt}</span>
              <span className="text-[11.5px] text-ink-3">{when(n.updatedAt)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="font-display text-[26px] leading-none">Pose la première pierre</p>
          <p className="max-w-[380px] text-[13.5px] text-ink-3">Écris en Markdown, glisse des images, des vidéos ou des fichiers dans la page, et verrouille les notes sensibles avec le coffre.</p>
          <Button variant="primary" className="mt-2" onClick={newNote}>
            <Plus className="size-4" strokeWidth={2.4} />
            Nouvelle note
          </Button>
        </div>
      )}
    </>
  );
}
