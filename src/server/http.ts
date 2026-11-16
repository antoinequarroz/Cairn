import { NextResponse } from "next/server";

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function body(req: Request): Promise<Record<string, unknown>> {
  const data = await req.json().catch(() => null);
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

/** A string field within a size limit, `undefined` when absent, `null` when invalid. */
export function text(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length <= max ? value : null;
}

export const MAX_TITLE = 300;
export const MAX_NOTE = 2_000_000;
export const MAX_BLOB = 400_000;
