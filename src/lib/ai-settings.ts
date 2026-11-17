// The shape of Réglages > IA, shared by the page and the API. No secret ever travels in a view.
import type { ProviderId } from "./ai";

export type AiProviderView = {
  id: ProviderId;
  /** Has everything it needs, from the app or the .env. */
  configured: boolean;
  /** Where the key or token comes from. The app wins over the .env. */
  secretSource: "app" | "env" | null;
  /** The last characters of the key, to recognise it. */
  secretHint: string | null;
  /** A key was saved but can't be opened any more (CAIRN_SECRET changed, or secret.key lost). */
  unreadable: boolean;
  /** As entered in the app; empty means modelFallback applies. */
  model: string;
  /** From the .env, or the default. */
  modelFallback: string;
  url?: string;
  urlFallback?: string;
};

export type AiSettingsView = {
  /** The choice made in the app. null: not chosen there, AI_PROVIDER or automatic applies. */
  provider: "auto" | ProviderId | null;
  envProvider: string | null;
  active: { provider: ProviderId | null; ready: boolean; label: string };
  providers: AiProviderView[];
};

/** A change sent by the page. `secret: null` (or "") removes the key saved in the app. */
export type AiSettingsUpdate = {
  provider?: "auto" | ProviderId | null;
  providers?: Partial<Record<ProviderId, { model?: string; url?: string; secret?: string | null }>>;
};
