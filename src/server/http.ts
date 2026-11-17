import { NextResponse } from "next/server";
import { MAX_CONTEXT_NOTES } from "@/lib/chat";
import { getFolder } from "./db";

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

/** A folder reference: `undefined` when absent, `null` for the root, the id of an existing folder, or `false` when invalid. */
export function folderRef(value: unknown): string | null | undefined | false {
  if (value === undefined || value === null) return value;
  return typeof value === "string" && !!getFolder(value) && value;
}

/** A list of note ids, without duplicates: `undefined` when absent, `null` when invalid. */
export function noteIds(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_NOTES || !value.every((v) => typeof v === "string" && v.length <= 64)) return null;
  return [...new Set(value as string[])];
}
