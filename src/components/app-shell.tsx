"use client";

import { FileText, KeyRound, MessagesSquare, Plus, Search, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { NotesProvider, useNotes } from "@/lib/notes-store";
import { lockVault, useVaultKey } from "@/lib/vault-store";
import { cn } from "@/lib/utils";
import { CommandMenu } from "./command-menu";
import { FolderTree } from "./folder-tree";
import { Logo } from "./logo";
import { Kbd } from "./ui";

const NAV = [
  { href: "/notes", label: "Notes", Icon: FileText },
  { href: "/chat", label: "Discussions", Icon: MessagesSquare },
  { href: "/vault", label: "Coffre", Icon: KeyRound },
  { href: "/settings", label: "Réglages", Icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <NotesProvider>
      <Shell>{children}</Shell>
    </NotesProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { loaded, error, notes, newNote, commandOpen, setCommandOpen } = useNotes();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(!commandOpen);
      } else if (!typing && !commandOpen && e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        newNote();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandOpen, setCommandOpen, newNote]);

  return (
    <div className="flex h-dvh min-h-0">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col p-2 pl-0 max-md:p-0">
        <MobileBar />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface/70 shadow-card backdrop-blur-xl max-md:rounded-none max-md:border-0">
          {error && !notes.length ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <p className="text-[15px] font-medium">Impossible de charger les notes</p>
              <p className="text-[13px] text-ink-3">{error}</p>
            </div>
          ) : loaded ? (
            children
          ) : (
            <div className="flex-1" />
          )}
        </div>
      </main>
      <CommandMenu />
      <Toaster position="bottom-right" toastOptions={{ className: "!rounded-xl !border-line-strong !bg-surface !text-ink !shadow-card !font-sans" }} />
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const { notes, conversations, newNote, setCommandOpen } = useNotes();
  const unlocked = !!useVaultKey();

  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-1 px-3 py-3 max-md:hidden">
      <div className="flex items-center gap-2 px-1.5 pb-3">
        <Logo />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Cairn</span>
        <span className="ml-auto rounded-md border border-line px-1.5 py-px font-mono text-[10px] text-ink-3">v0.1</span>
      </div>

      <div className="mb-2 flex gap-1.5">
        <button
          onClick={() => newNote()}
          className="press flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-medium text-accent-ink shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_6px_16px_-6px_var(--accent)] hover:brightness-[1.06]"
        >
          <Plus className="size-4" strokeWidth={2.4} />
          Nouvelle note
          <span className="ml-1 rounded border border-white/30 px-1 font-mono text-[10px] leading-4 text-white/80">N</span>
        </button>
        <button onClick={() => setCommandOpen(true)} aria-label="Rechercher" className="press flex size-9 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink-2 shadow-card hover:text-ink">
          <Search className="size-4" />
        </button>
      </div>

      <nav className="flex flex-col gap-px">
        {NAV.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13.5px] transition-colors duration-150",
                active ? "bg-surface font-medium text-ink shadow-card" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink",
              )}
            >
              <Icon className={cn("size-4", active ? "text-accent" : "text-ink-3")} strokeWidth={2} />
              {label}
              {href === "/notes" && notes.length > 0 && <span className="tabular ml-auto text-[11px] text-ink-3">{notes.length}</span>}
              {href === "/chat" && conversations.length > 0 && <span className="tabular ml-auto text-[11px] text-ink-3">{conversations.length}</span>}
            </Link>
          );
        })}
      </nav>

      <FolderTree />

      <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-line bg-surface/60 p-2.5">
        <div className="flex items-center gap-2 text-[12px]">
          <span className={cn("size-1.5 shrink-0 rounded-full", unlocked ? "bg-ok shadow-[0_0_0_3px_color-mix(in_oklab,var(--ok)_18%,transparent)]" : "bg-ink-3")} />
          <span className="font-medium">Coffre</span>
          {unlocked ? (
            <button onClick={lockVault} className="ml-auto text-ink-3 hover:text-ink">
              Verrouiller
            </button>
          ) : (
            <span className="ml-auto text-ink-3">Verrouillé</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
          <span>pour tout trouver</span>
        </div>
      </div>
    </aside>
  );
}

function MobileBar() {
  const pathname = usePathname();
  const { newNote, setCommandOpen } = useNotes();
  return (
    <div className="flex items-center gap-1 border-b border-line px-3 py-2 md:hidden">
      <Logo className="mr-1 size-6" />
      {NAV.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-label={label} className={cn("flex size-9 items-center justify-center rounded-lg", pathname.startsWith(href) ? "bg-surface text-accent shadow-card" : "text-ink-3")}>
          <Icon className="size-[18px]" />
        </Link>
      ))}
      <button onClick={() => setCommandOpen(true)} aria-label="Rechercher" className="ml-auto flex size-9 items-center justify-center rounded-lg text-ink-3">
        <Search className="size-[18px]" />
      </button>
      <button onClick={() => newNote()} aria-label="Nouvelle note" className="press flex size-9 items-center justify-center rounded-lg bg-accent text-accent-ink">
        <Plus className="size-4" strokeWidth={2.4} />
      </button>
    </div>
  );
}
