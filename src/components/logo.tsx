import { cn } from "@/lib/utils";

/** A cairn: three stacked stones, the top one in the accent colour. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cn("size-7", className)} aria-hidden>
      <rect width="28" height="28" rx="8" fill="var(--ink)" />
      <rect x="5.5" y="17.6" width="17" height="4.9" rx="2.45" fill="var(--bg)" opacity=".55" />
      <rect x="8" y="11.9" width="12" height="4.6" rx="2.3" fill="var(--bg)" opacity=".8" />
      <rect x="10.6" y="6.2" width="6.8" height="4.6" rx="2.3" fill="var(--accent)" />
    </svg>
  );
}
