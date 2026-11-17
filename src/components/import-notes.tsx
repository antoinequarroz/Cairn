"use client";

import { zipSync } from "fflate";
import { FileText, FolderOpen, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FolderSelect } from "@/components/folder-select";
import { Button } from "@/components/ui";
import { useNotes } from "@/lib/notes-store";
import { uploadFile } from "@/lib/upload";
import { api } from "@/lib/utils";

type Report = { folderId: string; notes: number; folders: number; files: number; skipped: string[] };

const plural = (n: number, one: string, many: string) => `${n} ${n <= 1 ? one : many}`;

/**
 * Imports notes: a Notion export (its zip, as is), a folder of Markdown files, or a few .md files.
 * Folders and loose files are zipped here first, so the server has one way to read them all.
 */
export function ImportNotes() {
  const { reload } = useNotes();
  const router = useRouter();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);

  // Opened from ⌘K (/settings#import): bring the card into view.
  useEffect(() => {
    if (window.location.hash !== "#import") return;
    const t = setTimeout(() => card.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 300);
    return () => clearTimeout(t);
  }, []);

  const start = async (list: FileList | null) => {
    if (!list?.length) return;
    const picked = [...list];
    setSkipped([]);
    try {
      let zip: File;
      if (picked.length === 1 && /\.zip$/i.test(picked[0].name)) {
        zip = picked[0];
      } else {
        setStep("Préparation…");
        const entries: Record<string, Uint8Array> = {};
        for (const f of picked) entries[f.webkitRelativePath || f.name] = new Uint8Array(await f.arrayBuffer());
        const top = picked[0].webkitRelativePath.split("/")[0];
        // level 0: images and videos are already compressed, and this stays fast.
        zip = new File([zipSync(entries, { level: 0 }) as Uint8Array<ArrayBuffer>], `${top || "Import Markdown"}.zip`, { type: "application/zip" });
      }
      setStep("Envoi…");
      const { file } = await uploadFile(zip);
      setStep("Import…");
      const { report } = await api<{ report: Report }>("/api/import", { method: "POST", json: { fileId: file.id, folderId } });
      await reload();
      setSkipped(report.skipped);
      toast(`${plural(report.notes, "note importée", "notes importées")}`, {
        description: [plural(report.folders, "dossier", "dossiers"), plural(report.files, "fichier joint", "fichiers joints")].join(", "),
        action: { label: "Ouvrir", onClick: () => router.push(`/folders/${report.folderId}`) },
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStep("");
      if (files.current) files.current.value = "";
      if (folder.current) folder.current.value = "";
    }
  };

  const busy = !!step;
  return (
    <div ref={card} id="import" className="flex scroll-mt-4 flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
      <div>
        <h2 className="text-[15px] font-medium">Importer des notes</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Depuis Notion : Paramètres › Exporter tout le contenu, format « Markdown et CSV », puis choisis le fichier .zip tel quel. Ou un dossier de fichiers Markdown. Les sous-dossiers, les images et les liens entre pages suivent.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-ink-3">Ranger dans</span>
        <FolderSelect value={folderId} onChange={setFolderId} label="Dossier où importer" className="border border-line-strong" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => files.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {step || "Export Notion ou fichiers…"}
        </Button>
        <Button onClick={() => folder.current?.click()} disabled={busy}>
          <FolderOpen className="size-4" />
          Dossier Markdown…
        </Button>
      </div>
      <input ref={files} type="file" multiple accept=".zip,.md,.markdown,.txt,.csv" className="hidden" onChange={(e) => start(e.target.files)} />
      <input ref={folder} type="file" className="hidden" onChange={(e) => start(e.target.files)} {...{ webkitdirectory: "" }} />
      {skipped.length > 0 && (
        <div className="rounded-lg bg-surface-2 p-3 text-[12.5px] text-ink-2">
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            <FileText className="size-3.5" />
            Pas importé
          </p>
          <ul className="list-disc pl-5 text-ink-3">
            {skipped.slice(0, 10).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
