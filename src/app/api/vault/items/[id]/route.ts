import { NextResponse } from "next/server";
import { deleteVaultItem, listVaultItems, saveVaultItem } from "@/server/db";
import { body, fail, MAX_BLOB, text } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const data = text((await body(req)).data, MAX_BLOB);
  if (!data || !data.startsWith("v1.")) return fail("Élément invalide");
  if (!listVaultItems().some((i) => i.id === id)) return fail("Élément introuvable", 404);
  return NextResponse.json({ item: saveVaultItem(id, data) });
}

export async function DELETE(_: Request, { params }: Ctx) {
  return deleteVaultItem((await params).id) ? NextResponse.json({ ok: true }) : fail("Élément introuvable", 404);
}
