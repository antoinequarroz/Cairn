"use client";

import { Columns2, Eye, Lock, LockOpen, MessagesSquare, Paperclip, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { decryptText, encryptText } from "@/lib/crypto";
import { markdownForFile, renderMarkdown } from "@/lib/markdown";
import { useNotes } from "@/lib/notes-store";
import type { Note } from "@/lib/types";
import { uploadFile } from "@/lib/upload";
import { api, cn } from "@/lib/utils";
import { useVaultKey, vaultKey } from "@/lib/vault-store";
import { AiButton, AiPanel, useAi, type AiTarget } from "./ai-assistant";
import { Button } from "./ui";
import { FolderSelect } from "./folder-select";
import { FormatToolbar, SlashMenu, useFormatting } from "./format-toolbar";
import { UnlockForm } from "./unlock-form";
import { Prose } from "./prose";

type Mode = "write" | "split" | "preview";
type SaveState = "saved" | "dirty" | "saving" | "error";

const MODES: { mode: Mode; label: string; Icon: typeof Eye }[] = [
  { mode: "write", label: "Écrire", Icon: Pencil },
  { mode: "split", label: "Côte à côte", Icon: Columns2 },
  { mode: "preview", label: "Aperçu", Icon: Eye },
];

export function Editor({ id }: { id: string }) {
  const router = useRouter();
  const { notes, touch, remove, move, newConversation } = useNotes();
  const key = useVaultKey();
  const [note, setNote] = useState<Note | null>(null);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState("");
  // The readable Markdown. `null` while an encrypted note is still locked.
  const [content, setContent] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("split");
  const [save, setSave] = useState<SaveState>("saved");
  const [uploading, setUploading] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // What the next save must send. Kept in a ref so the debounced save always sees the latest text.
  const draft = useRef({ title: "", content: "", encrypted: false });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saving = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setMode("write");
    api<{ note: Note }>(`/api/notes/${id}`).then(
      ({ note }) => {
        setNote(note);
        setTitle(note.title);
        draft.current = { title: note.title, content: "", encrypted: note.encrypted };
        if (!note.encrypted) {
          draft.current.content = note.content;
          setContent(note.content);
        }
      },
      () => setMissing(true),
    );
  }, [id]);

  // An encrypted note opens as soon as the vault is unlocked.
  useEffect(() => {
    if (!note?.encrypted || content !== null || !key) return;
    decryptText(key, note.content).then(
      (plain) => {
        draft.current.content = plain;
        setContent(plain);
      },
      () => toast.error("Cette note n'a pas pu être déchiffrée avec ce coffre."),
    );
  }, [note, key, content]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    // Saves run one after the other, so an older save can never land after a newer one.
    saving.current = saving.current.then(async () => {
      const d = { ...draft.current };
      setSave("saving");
      try {
        let stored = d.content;
        if (d.encrypted) {
          const k = vaultKey();
          // Never fall back to saving readable text for a note meant to be encrypted.
          if (!k) throw new Error("Le coffre s'est verrouillé. Déverrouille-le pour enregistrer.");
          stored = await encryptText(k, d.content);
        }
        const { note } = await api<{ note: Note }>(`/api/notes/${id}`, { method: "PATCH", json: { title: d.title, content: stored, encrypted: d.encrypted } });
        touch(note);
        const cur = draft.current;
        setSave(cur.title === d.title && cur.content === d.content && cur.encrypted === d.encrypted ? "saved" : "dirty");
      } catch (e) {
        setSave("error");
        toast.error((e as Error).message, { id: "save-error" });
      }
    });
    return saving.current;
  }, [id, touch]);

  const change = useCallback(
    (patch: Partial<typeof draft.current>, now = false) => {
      Object.assign(draft.current, patch);
      setSave("dirty");
      clearTimeout(timer.current);
      if (now) flush();
      else timer.current = setTimeout(flush, 700);
    },
    [flush],
  );

  // Leaving the note with unsaved text: save it right away.
  useEffect(
    () => () => {
      if (timer.current) flush();
    },
    [flush],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  const insert = (text: string) => {
    const el = area.current;
    const cur = draft.current.content;
    const at = el ? el.selectionStart : cur.length;
    const before = cur.slice(0, at);
    const next = `${before}${before && !before.endsWith("\n") ? "\n" : ""}${text}\n${cur.slice(el ? el.selectionEnd : at)}`;
    setContent(next);
    change({ content: next });
  };

  // The assistant reads the draft (always the latest text) and writes back through change(), like typing does.
  const aiTarget = useMemo<AiTarget>(
    () => ({
      getContent: () => draft.current.content,
      getTitle: () => draft.current.title,
      isEncrypted: () => draft.current.encrypted,
      area,
      apply: (next) => {
        setContent(next);
        change({ content: next });
      },
    }),
    [change],
  );
  const ai = useAi(aiTarget, !!note?.encrypted);
  const pickFile = useCallback(() => fileInput.current?.click(), []);
  const runAi = ai.run;
  const linkable = useMemo(() => notes.filter((n) => n.id !== id), [notes, id]);
  const fmt = useFormatting(area, { onUpload: pickFile, notes: linkable, ai: note?.encrypted ? null : runAi });

  const upload = async (files: File[]) => {
    for (const file of files) {
      setUploading((n) => n + 1);
      try {
        const { file: info, url } = await uploadFile(file);
        insert(markdownForFile(info.name, info.mime, url));
      } catch (e) {
        toast.error(`${file.name} : ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const toggleLock = () => {
    if (!note || content === null) return;
    if (!draft.current.encrypted && !vaultKey()) {
      toast("Déverrouille d'abord le coffre", { description: "La note sera chiffrée avec la clé du coffre.", action: { label: "Ouvrir le coffre", onClick: () => router.push("/vault") } });
      return;
    }
    const encrypted = !draft.current.encrypted;
    setNote({ ...note, encrypted });
    change({ encrypted }, true);
    if (!encrypted) {
      toast("Note déchiffrée", { description: "Elle est de nouveau lisible par le serveur (recherche, IA)." });
      return;
    }
    // Text written before the padlock was saved in clear: it stays in the nightly backups until they expire.
    const hadClearText = !!content.trim();
    toast("Note chiffrée de bout en bout", {
      description: hadClearText
        ? "Le serveur ne peut plus la lire, son titre reste visible. Sa version en clair reste dans les sauvegardes des 30 derniers jours (voir Sécurité dans la documentation pour les purger)."
        : "Le serveur ne peut plus la lire. Son titre reste visible.",
      duration: hadClearText ? 10_000 : undefined,
    });
  };

  const del = async () => {
    if (!window.confirm("Supprimer cette note ? C'est définitif.")) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    try {
      await saving.current;
      await api(`/api/notes/${id}`, { method: "DELETE" });
      remove(id);
      router.push("/notes");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const html = useMemo(() => (content !== null && mode !== "write" ? renderMarkdown(content) : ""), [content, mode]);

  if (missing)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-[15px] font-medium">Cette note n&apos;existe plus</p>
        <Link href="/notes" className="text-[13px] text-accent">
          Revenir aux notes
        </Link>
      </div>
    );
  if (!note) return <div className="flex-1" />;

  const locked = note.encrypted && content === null;
  // Where the note is filed: the sidebar may move it (drag and drop) while it is open, the store knows.
  const filed = notes.find((n) => n.id === id);
  const folderId = filed ? filed.folderId : note.folderId;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex items-center gap-2 border-b border-line px-5 py-2.5 max-md:px-3">
        <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
          {MODES.map(({ mode: m, label, Icon }) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              title={label}
              className={cn("flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] transition-colors duration-150", m === "split" && "max-md:hidden", mode === m ? "bg-surface font-medium text-ink shadow-card" : "text-ink-3 hover:text-ink")}
            >
              <Icon className="size-3.5" />
              <span className="max-lg:hidden">{label}</span>
            </button>
          ))}
        </div>
        <span className={cn("ml-1 text-[12px]", save === "error" ? "text-danger" : "text-ink-3")} aria-live="polite">
          {uploading ? "Envoi du fichier…" : save === "saved" ? "Enregistré" : save === "error" ? "Non enregistré" : "Enregistrement…"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
          <Button size="sm" variant="ghost" disabled={locked} onClick={() => fileInput.current?.click()} title="Ajouter une image, une vidéo ou un fichier">
            <Paperclip className="size-3.5" />
            <span className="max-md:hidden">Joindre</span>
          </Button>
          <FolderSelect value={folderId} onChange={(f) => move("note", id, f)} className="max-w-[180px]" />
          <AiButton ai={ai} disabled={locked} />
          {!note.encrypted && (
            <Button size="sm" variant="ghost" onClick={async () => { await flush(); newConversation(folderId, [id]); }} title="Ouvrir une discussion avec l'IA, cette note en contexte">
              <MessagesSquare className="size-3.5" />
              <span className="max-lg:hidden">Discuter</span>
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={locked} onClick={toggleLock} title={note.encrypted ? "Retirer le chiffrement de bout en bout" : "Chiffrer cette note de bout en bout"} className={cn(note.encrypted && "text-accent")}>
            {note.encrypted ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
            <span className="max-md:hidden">{note.encrypted ? "Chiffrée" : "Chiffrer"}</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={del} aria-label="Supprimer la note" title="Supprimer">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          change({ title: e.target.value });
        }}
        placeholder="Sans titre"
        aria-label="Titre"
        className="w-full bg-transparent px-7 pt-6 pb-2 font-display text-[34px] leading-tight outline-none placeholder:text-ink-3 max-md:px-4 max-md:text-[28px]"
      />

      {locked ? (
        <div className="flex flex-1 items-start justify-center p-7">
          <div className="w-full max-w-[380px] rounded-2xl border border-line bg-surface p-6 shadow-card">
            <Lock className="size-5 text-accent" />
            <p className="mt-3 text-[15px] font-medium">Note chiffrée de bout en bout</p>
            <p className="mt-1 mb-4 text-[13px] text-ink-3">Entre le mot de passe maître du coffre pour la lire.</p>
            <UnlockForm />
          </div>
        </div>
      ) : (
        <>
          {mode !== "preview" && <FormatToolbar fmt={fmt} />}
          <div className={cn("relative grid min-h-0 flex-1", mode === "split" ? "grid-cols-2" : "grid-cols-1")}>
            {mode !== "preview" && (
              <textarea
                ref={area}
                value={content ?? ""}
                onChange={(e) => {
                  setContent(e.target.value);
                  change({ content: e.target.value });
                }}
                onInput={fmt.onInput}
                onKeyDown={fmt.onKeyDown}
                onBlur={fmt.close}
                onPaste={(e) => {
                  const files = [...e.clipboardData.files];
                  if (files.length) {
                    e.preventDefault();
                    upload(files);
                  }
                }}
                onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
                onDrop={(e) => {
                  if (!e.dataTransfer.files.length) return;
                  e.preventDefault();
                  upload([...e.dataTransfer.files]);
                }}
                spellCheck
                placeholder={"Écris ici…\n\nTape / pour insérer un titre, une liste, un tableau ou une image,\nou utilise la barre au-dessus pour mettre en forme.\n\nGlisse une image, une vidéo ou un fichier ici."}
                className={cn("scroll-thin min-h-0 resize-none bg-transparent px-7 py-3 font-mono text-[13.5px] leading-relaxed outline-none placeholder:text-ink-3 max-md:px-4", mode === "split" && "border-r border-line")}
              />
            )}
            {mode !== "write" && (
              <div className="scroll-thin min-h-0 overflow-y-auto px-7 py-3 max-md:px-4">
                {html ? <Prose html={html} /> : <p className="text-[13.5px] text-ink-3">L&apos;aperçu apparaît ici.</p>}
              </div>
            )}
            {mode !== "preview" && <SlashMenu fmt={fmt} />}
          </div>
        </>
      )}
      {!locked && <AiPanel ai={ai} />}
    </div>
  );
}
