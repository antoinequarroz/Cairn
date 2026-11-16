import { NextResponse } from "next/server";
import { getVaultMeta, saveVaultItem } from "@/server/db";
import { body, fail, MAX_BLOB, text } from "@/server/http";

export async function POST(req: Request) {
  const data = text((await body(req)).data, MAX_BLOB);
  if (!data || !data.startsWith("v1.")) return fail("Élément invalide");
  if (!getVaultMeta()) return fail("Crée d'abord le coffre", 409);
  return NextResponse.json({ item: saveVaultItem(undefined, data) }, { status: 201 });
}
