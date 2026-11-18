"use client";

import { ExternalLink, LayoutGrid, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSuite } from "@/lib/suite-context";
import { cn } from "@/lib/utils";

/** The apps menu of the PostMelo suite: one click to Alfred, Metricove… signed in by the same account. */
export function SuiteMenu({ className, align = "left" }: { className?: string; align?: "left" | "right" }) {
  const { apps, account } = useSuite();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!apps.length) return null;
  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Apps de la suite PostMelo"
        aria-expanded={open}
        title="Apps PostMelo"
        className={cn("press flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.05] hover:text-ink", open && "bg-ink/[0.05] text-ink")}
      >
        <LayoutGrid className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "rise absolute top-10 z-50 w-[248px] rounded-xl border border-line-strong bg-surface p-1.5 shadow-card",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Suite PostMelo</p>
          {apps.map((app) => (
            <a key={app.url} role="menuitem" href={app.url} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink/[0.04]">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-white" style={{ background: app.color }}>
                {app.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-medium">{app.name}</span>
                {app.role && <span className="truncate text-[11.5px] text-ink-3">{app.role}</span>}
              </span>
            </a>
          ))}
          {account && (
            <>
              <div className="my-1 h-px bg-line" />
              <a role="menuitem" href={account} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-ink/[0.04] hover:text-ink">
                <UserRound className="size-4 text-ink-3" />
                Mon Compte Postmelo
                <ExternalLink className="ml-auto size-3.5 text-ink-3" />
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
