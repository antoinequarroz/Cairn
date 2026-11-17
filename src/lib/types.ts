export type NoteSummary = { id: string; title: string; encrypted: boolean; folderId: string | null; updatedAt: string; excerpt: string };

export type Note = { id: string; title: string; content: string; encrypted: boolean; folderId: string | null; createdAt: string; updatedAt: string };

/** A folder holds notes, discussions and other folders. A folder at the root is a project. */
export type Folder = {
  id: string;
  parentId: string | null;
  name: string;
  /** Standing instructions for the AI in every discussion of this folder and of its subfolders. */
  instructions: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationSummary = { id: string; folderId: string | null; title: string; updatedAt: string };

export type Conversation = ConversationSummary & {
  /** Notes the AI reads with every message of this discussion. */
  contextNoteIds: string[];
  /** "Mes notes" mode: with each message, the AI searches the notes (one folder's, or all when folderId is null). Off when null. */
  notesSearch: NotesSearch | null;
  createdAt: string;
};

export type NotesSearch = { folderId: string | null };

/** A note found for an answer in "Mes notes" mode. */
export type ChatSource = { id: string; title: string };

/**
 * One message of a discussion. An answer is saved while it streams: `streaming` until it ends,
 * then `done`, `stopped` (Stop pressed, or the server restarted) or `error`.
 */
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  state: "streaming" | "done" | "stopped" | "error";
  error?: string;
  /** Who answered, as shown to the user: "Claude (claude-opus-5-5)". */
  model?: string;
  /** "Mes notes" mode: the notes the AI was given for this answer, best match first. */
  sources?: ChatSource[];
  createdAt: string;
};

/** Public parameters of the vault. Nothing here is secret, but none of it opens the vault without the master password. */
export type VaultMeta = {
  v: 1;
  kdf: { name: "argon2id"; salt: string; memoryKiB: number; iterations: number; parallelism: number };
  /** The vault key, encrypted with the key derived from the master password. */
  wrappedKey: string;
};

export type VaultItemRow = { id: string; data: string; updatedAt: string };

export type VaultItemType = "login" | "ssh" | "secret";

/** What is inside the encrypted blob of an item. */
export type VaultItemData = {
  type: VaultItemType;
  name: string;
  username?: string;
  password?: string;
  url?: string;
  host?: string;
  privateKey?: string;
  publicKey?: string;
  passphrase?: string;
  notes?: string;
};

export type VaultItem = VaultItemData & { id: string; updatedAt: string };

export type FileInfo = { id: string; name: string; mime: string; size: number; createdAt: string };

/**
 * One hit of the full-text search. In `title` and `snippet`, the matched words sit between \u0001
 * and \u0002 (see <Highlighted>). An encrypted note is only found by its title.
 */
export type SearchResult = {
  kind: "note" | "conversation";
  id: string;
  title: string;
  snippet: string;
  encrypted: boolean;
  folderId: string | null;
  updatedAt: string;
};
