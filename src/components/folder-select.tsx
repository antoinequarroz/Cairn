"use client";

import { Folder as FolderIcon } from "lucide-react";
import { flattenFolders, useNotes } from "@/lib/notes-store";
import { cn } from "@/lib/utils";

/**
 * Where something is filed, as a native select: it works the same with a mouse, a keyboard and on
 * the iPhone. `exclude` hides a folder and its subfolders (a folder cannot go inside itself).
 */
export function FolderSelect({ value, onChange, exclude, className, label = "Dossier" }: { value: string | null; onChange: (folderId: string | null) => void; exclude?: string; className?: string; label?: string }) {
  const { folders } = useNotes();
  const options = flattenFolders(folders);
  let skipDepth = -1;
  const visible = options.filter(({ folder, depth }) => {
    if (skipDepth >= 0 && depth > skipDepth) return false;
    skipDepth = -1;
    if (folder.id === exclude) {
      skipDepth = depth;
      return false;
    }
    return true;
  });
  return (
    <label className={cn("relative flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-ink-2 hover:bg-ink/5 hover:text-ink", className)} title={label}>
      <FolderIcon className="size-3.5 shrink-0" />
      <span className="truncate max-md:hidden">{folders.find((f) => f.id === value)?.name ?? "Sans dossier"}</span>
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">Sans dossier</option>
        {visible.map(({ folder, depth }) => (
          <option key={folder.id} value={folder.id}>
            {`${"   ".repeat(depth)}${folder.name}`}
          </option>
        ))}
      </select>
    </label>
  );
}
