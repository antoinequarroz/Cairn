"use client";

import { ChevronRight, FilePlus2, FileText, Folder as FolderIcon, FolderOpen, FolderPlus, Lock, MessageSquarePlus, MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNotes, type ItemKind } from "@/lib/notes-store";
import type { Folder } from "@/lib/types";
import { cn, when } from "@/lib/utils";

const OPEN_KEY = "cairn.folders.open";
const DRAG_TYPE = "application/x-cairn-item";

type Leaf = { kind: "note" | "conversation"; id: string; title: string; updatedAt: string; encrypted?: boolean };

function readOpen(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * The sidebar's tree: projects (root folders), their subfolders, notes and discussions, then what
 * is filed nowhere. Anything can be dragged onto a folder, or onto "Sans dossier".
 */
export function FolderTree() {
  const pathname = usePathname();
  const { notes, folders, conversations, newFolder, move } = useNotes();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => setOpen(readOpen()), []);
  const toggle = useCallback((id: string, value?: boolean) => {
    setOpen((cur) => {
      const next = new Set(cur);
      if (value ?? !next.has(id)) next.add(id);
      else next.delete(id);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        // Private browsing: the tree simply forgets what was open.
      }
      return next;
    });
  }, []);

  const leaves = useMemo(() => {
    const map = new Map<string | null, Leaf[]>();
    const ids = new Set(folders.map((f) => f.id));
    const add = (folderId: string | null, leaf: Leaf) => {
      // A folder that no longer exists here (deleted on another device): show its content at the root.
      const key = folderId && ids.has(folderId) ? folderId : null;
      map.set(key, [...(map.get(key) ?? []), leaf]);
    };
    for (const c of conversations) add(c.folderId, { kind: "conversation", id: c.id, title: c.title, updatedAt: c.updatedAt });
    for (const n of notes) add(n.folderId, { kind: "note", id: n.id, title: n.title, updatedAt: n.updatedAt, encrypted: n.encrypted });
    for (const list of map.values()) list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return map;
  }, [notes, conversations, folders]);

  const children = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    const ids = new Set(folders.map((f) => f.id));
    for (const f of folders) {
      const key = f.parentId && ids.has(f.parentId) ? f.parentId : null;
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return map;
  }, [folders]);

  // The folder of the page on screen, and its parents, open by themselves.
  const activeId = pathname.match(/^\/(?:notes|chat|folders)\/([^/]+)/)?.[1];
  useEffect(() => {
    if (!activeId) return;
    const start = pathname.startsWith("/folders/")
      ? folders.find((f) => f.id === activeId)?.parentId
      : (notes.find((n) => n.id === activeId)?.folderId ?? conversations.find((c) => c.id === activeId)?.folderId);
    const seen = new Set<string>();
    for (let f = folders.find((x) => x.id === start); f && !seen.has(f.id); f = folders.find((x) => x.id === f!.parentId)) {
      seen.add(f.id);
      if (!open.has(f.id)) toggle(f.id, true);
    }
    // Only when the page changes: closing a folder by hand must stay closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, folders.length]);

  const drop = (e: React.DragEvent, folderId: string | null) => {
    setDropTarget(null);
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    try {
      const item = JSON.parse(raw) as { kind: ItemKind; id: string };
      if (item.kind === "folder" && item.id === folderId) return;
      move(item.kind, item.id, folderId);
      if (folderId) toggle(folderId, true);
    } catch {
      // Not one of ours.
    }
  };
  const dropProps = (key: string, folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
    onDrop: (e: React.DragEvent) => drop(e, folderId),
  });

  const roots = children.get(null) ?? [];
  const loose = leaves.get(null) ?? [];

  return (
    <div className="scroll-thin -mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
      <div className="mt-5 flex items-center justify-between px-2 pb-1.5">
        <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Projets</span>
        <button onClick={() => newFolder(null)} aria-label="Nouveau projet" title="Nouveau projet" className="flex size-5 items-center justify-center rounded text-ink-3 hover:bg-ink/[0.06] hover:text-ink">
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-px">
        {roots.map((f) => (
          <FolderNode key={f.id} folder={f} depth={0} open={open} toggle={toggle} childFolders={children} leaves={leaves} pathname={pathname} dropTarget={dropTarget} dropProps={dropProps} />
        ))}
        {!roots.length && (
          <button onClick={() => newFolder(null)} className="rounded-lg px-2 py-1 text-left text-[12.5px] text-ink-3 hover:text-ink">
            Crée un projet pour ranger notes et discussions.
          </button>
        )}
      </div>

      <div {...dropProps("root", null)} className={cn("mt-4 flex flex-1 flex-col rounded-lg", dropTarget === "root" && "bg-accent-soft")}>
        <div className="flex items-center justify-between px-2 pb-1.5">
          <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Sans dossier</span>
        </div>
        <div className="flex flex-col gap-px">
          {loose.map((leaf) => (
            <LeafRow key={`${leaf.kind}-${leaf.id}`} leaf={leaf} depth={0} active={pathname === leafHref(leaf)} detailed />
          ))}
          {!loose.length && <p className="px-2 py-1 text-[12.5px] text-ink-3">Rien en vrac.</p>}
        </div>
      </div>
    </div>
  );
}

const leafHref = (leaf: Leaf) => (leaf.kind === "note" ? `/notes/${leaf.id}` : `/chat/${leaf.id}`);

const dragStart = (kind: ItemKind, id: string) => (e: React.DragEvent) => {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind, id }));
  e.dataTransfer.effectAllowed = "move";
};

type NodeProps = {
  folder: Folder;
  depth: number;
  open: Set<string>;
  toggle: (id: string, value?: boolean) => void;
  childFolders: Map<string | null, Folder[]>;
  leaves: Map<string | null, Leaf[]>;
  pathname: string;
  dropTarget: string | null;
  dropProps: (key: string, folderId: string | null) => Record<string, unknown>;
};

function FolderNode(props: NodeProps) {
  const { folder, depth, open, toggle, childFolders, leaves, pathname, dropTarget, dropProps } = props;
  const isOpen = open.has(folder.id);
  const subs = childFolders.get(folder.id) ?? [];
  const items = leaves.get(folder.id) ?? [];
  const active = pathname === `/folders/${folder.id}`;
  const count = subs.length + items.length;
  return (
    <div>
      <div
        {...dropProps(folder.id, folder.id)}
        draggable
        onDragStart={dragStart("folder", folder.id)}
        className={cn(
          "group flex h-8 items-center gap-1 rounded-lg pr-1 transition-colors duration-150",
          active ? "bg-surface shadow-card" : "hover:bg-ink/[0.04]",
          dropTarget === folder.id && "bg-accent-soft ring-1 ring-accent/40",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button onClick={() => toggle(folder.id)} aria-label={isOpen ? "Replier" : "Déplier"} aria-expanded={isOpen} className="flex size-5 shrink-0 items-center justify-center rounded text-ink-3 hover:text-ink">
          <ChevronRight className={cn("size-3.5 transition-transform duration-150", isOpen && "rotate-90", !count && "opacity-30")} />
        </button>
        <Link href={`/folders/${folder.id}`} className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
          {isOpen ? <FolderOpen className="size-4 shrink-0 text-accent" /> : <FolderIcon className={cn("size-4 shrink-0", depth ? "text-ink-3" : "text-accent")} />}
          <span className="truncate">{folder.name}</span>
        </Link>
        <AddMenu folderId={folder.id} onAdd={() => toggle(folder.id, true)} />
        {count > 0 && <span className="tabular w-5 shrink-0 text-right text-[11px] text-ink-3 group-hover:hidden">{count}</span>}
      </div>
      {isOpen && (
        <div className="flex flex-col gap-px">
          {subs.map((f) => (
            <FolderNode key={f.id} {...props} folder={f} depth={depth + 1} />
          ))}
          {items.map((leaf) => (
            <LeafRow key={`${leaf.kind}-${leaf.id}`} leaf={leaf} depth={depth + 1} active={pathname === leafHref(leaf)} />
          ))}
        </div>
      )}
    </div>
  );
}

function LeafRow({ leaf, depth, active, detailed }: { leaf: Leaf; depth: number; active: boolean; detailed?: boolean }) {
  const Icon = leaf.kind === "conversation" ? MessagesSquare : FileText;
  return (
    <Link
      href={leafHref(leaf)}
      draggable
      onDragStart={dragStart(leaf.kind, leaf.id)}
      className={cn("flex items-center gap-2 rounded-lg py-1.5 pr-2 transition-colors duration-150", active ? "bg-surface shadow-card" : "hover:bg-ink/[0.04]")}
      style={{ paddingLeft: 8 + depth * 14 + (depth ? 6 : 0) }}
    >
      <Icon className={cn("size-3.5 shrink-0", leaf.kind === "conversation" ? "text-accent" : "text-ink-3")} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13px] leading-tight", !leaf.title && "text-ink-3")}>{leaf.title || (leaf.kind === "note" ? "Sans titre" : "Nouvelle discussion")}</span>
        {detailed && <span className="block truncate text-[11.5px] leading-tight text-ink-3">{when(leaf.updatedAt)}</span>}
      </span>
      {leaf.encrypted && <Lock className="size-3.5 shrink-0 text-accent" aria-label="Chiffrée de bout en bout" />}
    </Link>
  );
}

/** The "+" of a folder: a note, a discussion or a subfolder, created inside it. */
function AddMenu({ folderId, onAdd }: { folderId: string; onAdd: () => void }) {
  const { newNote, newConversation, newFolder } = useNotes();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const pick = (fn: () => void) => {
    setOpen(false);
    onAdd();
    fn();
  };
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Ajouter dans ce dossier"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn("flex size-5 items-center justify-center rounded text-ink-3 hover:bg-ink/[0.06] hover:text-ink", open ? "flex" : "hidden group-hover:flex focus-visible:flex")}
      >
        <Plus className="size-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute top-6 right-0 z-30 w-48 rounded-xl border border-line-strong bg-surface p-1 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)]">
          <MenuItem icon={<FilePlus2 className="size-4" />} onClick={() => pick(() => newNote(folderId))}>
            Nouvelle note
          </MenuItem>
          <MenuItem icon={<MessageSquarePlus className="size-4" />} onClick={() => pick(() => newConversation(folderId))}>
            Nouvelle discussion
          </MenuItem>
          <MenuItem icon={<FolderPlus className="size-4" />} onClick={() => pick(() => newFolder(folderId))}>
            Sous-dossier
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-ink-2 hover:bg-ink/[0.05] hover:text-ink">
      <span className="text-ink-3">{icon}</span>
      {children}
    </button>
  );
}
