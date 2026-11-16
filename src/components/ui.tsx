"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "press inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]",
        variant === "primary" &&
          "bg-accent text-accent-ink shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_1px_2px_rgba(0,0,0,0.12),0_6px_16px_-6px_var(--accent)] hover:brightness-[1.06]",
        variant === "secondary" && "border border-line-strong bg-surface text-ink shadow-card hover:bg-surface-2",
        variant === "ghost" && "text-ink-2 hover:bg-ink/5 hover:text-ink",
        variant === "danger" && "border border-line-strong bg-surface text-danger shadow-card hover:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
});

export const inputClass =
  "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-[14px] outline-none placeholder:text-ink-3 focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)]";

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-2 px-1 font-mono text-[10.5px] text-ink-3">{children}</kbd>;
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="flex items-end gap-3 border-b border-line px-7 py-5 max-md:px-4">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[28px] leading-none">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}
