import { NextResponse } from "next/server";
import { addVaultItems, getVaultMeta, saveVaultItem } from "@/server/db";
import { body, fail, MAX_BLOB, text } from "@/server/http";

/** Most items sent at once by an import (the browser sends batches of 200 at most, see vault-transfer.tsx). */
const MAX_BATCH = 500;

const isBlob = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_BLOB && v.startsWith("v1.");

/** Adds one item `{ data }`, or a batch from an import `{ items: [data, …] }`. Both arrive already encrypted. */
export async function POST(req: Request) {
  const b = await body(req);
  if (!getVaultMeta()) return fail("Crée d'abord le coffre", 409);
  if (b.items !== undefined) {
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > MAX_BATCH || !b.items.every(isBlob)) return fail("Éléments invalides");
    return NextResponse.json({ added: addVaultItems(b.items) }, { status: 201 });
  }
  const data = text(b.data, MAX_BLOB);
  if (!data || !data.startsWith("v1.")) return fail("Élément invalide");
  return NextResponse.json({ item: saveVaultItem(undefined, data) }, { status: 201 });
}
