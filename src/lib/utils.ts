export { default as cn } from "clsx";

export function when(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return d.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString("fr-CH", { weekday: "long" });
  return d.toLocaleDateString("fr-CH", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, init?.json !== undefined ? { ...init, headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.json) } : init);
  if (res.status === 401) window.location.href = "/login";
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Une erreur est survenue");
  return data as T;
}
