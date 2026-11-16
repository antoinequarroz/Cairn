export type NoteSummary = { id: string; title: string; encrypted: boolean; updatedAt: string; excerpt: string };

export type Note = { id: string; title: string; content: string; encrypted: boolean; createdAt: string; updatedAt: string };

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
