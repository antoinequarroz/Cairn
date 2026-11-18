"use client";

import { CalendarDays, FileText, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, PageHeader } from "@/components/ui";
import { useNotes } from "@/lib/notes-store";
import { meetingMarkdown, readMeeting, RETURN_COOKIE } from "@/lib/suite";
import { useSuite } from "@/lib/suite-context";
import type { Note } from "@/lib/types";
import { api, when } from "@/lib/utils";

/**
 * "Note de réunion", opened by another app of the suite (Alfred):
 * /notes/reunion?titre=Point%20projet&date=2026-11-19T14:00&fin=2026-11-19T15:00&lien=https://alfred…
 * Nothing is created until the button is pressed: any site could open this address.
 */
export default function MeetingPage() {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <Meeting />
    </Suspense>
  );
}

type Linked = { id: string; title: string; updatedAt: string };

function Meeting() {
  const params = useSearchParams();
  const { apps } = useSuite();
  const { reload } = useNotes();
  const router = useRouter();
  const meeting = useMemo(() => readMeeting(new URLSearchParams(params.toString()), apps), [params, apps]);
  const [linked, setLinked] = useState<Linked[] | null>(meeting.link ? null : []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The way back from the sign-in has been used.
    document.cookie = `${RETURN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }, []);

  useEffect(() => {
    if (!meeting.link) return;
    api<{ notes: Linked[] }>(`/api/links?url=${encodeURIComponent(meeting.link.href)}`)
      .then((r) => setLinked(r.notes))
      .catch(() => setLinked([]));
  }, [meeting.link]);

  const create = async () => {
    setBusy(true);
    try {
      const { note } = await api<{ note: Note }>("/api/notes", { method: "POST", json: { title: meeting.title, content: meetingMarkdown(meeting) } });
      await reload();
      router.replace(`/notes/${note.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Note de réunion" subtitle={meeting.link ? `Depuis ${meeting.link.app.name}` : undefined} />
      <div className="scroll-thin flex-1 overflow-y-auto p-7 max-md:p-4">
        <div className="rise flex max-w-[520px] flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <CalendarDays className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[16px] font-semibold break-words">{meeting.title}</p>
              {meeting.when && <p className="mt-0.5 text-[13px] text-ink-2 first-letter:uppercase">{meeting.when}</p>}
              {meeting.link && (
                <a href={meeting.link.href} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-[12.5px] text-accent hover:underline">
                  Voir l&apos;{meeting.link.kind === "Événement" ? "événement" : "original"} dans {meeting.link.app.name}
                </a>
              )}
            </div>
          </div>

          {linked === null ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-3">
              <Loader2 className="size-4 animate-spin" /> Recherche des notes déjà liées…
            </p>
          ) : linked.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[12.5px] font-medium text-ink-2">{linked.length > 1 ? "Des notes existent déjà pour cette réunion" : "Une note existe déjà pour cette réunion"}</p>
              {linked.map((n) => (
                <Link key={n.id} href={`/notes/${n.id}`} className="press flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13.5px] hover:border-line-strong">
                  <FileText className="size-4 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate">{n.title || "Sans titre"}</span>
                  <span className="text-[11.5px] text-ink-3">{when(n.updatedAt)}</span>
                </Link>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button variant={linked?.length ? "secondary" : "primary"} onClick={create} disabled={busy || linked === null}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {linked?.length ? "Créer une autre note" : "Créer la note"}
            </Button>
            <Button variant="ghost" onClick={() => router.push("/notes")}>
              Annuler
            </Button>
          </div>
          <p className="text-[12px] text-ink-3">La note reprend le titre, la date et un lien vers l&apos;événement, avec les rubriques Participants, Ordre du jour, Notes et Actions.</p>
        </div>
      </div>
    </>
  );
}
