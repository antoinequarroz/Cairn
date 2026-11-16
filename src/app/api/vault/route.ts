import { NextResponse } from "next/server";
import { createVaultMeta, getVaultMeta, listVaultItems } from "@/server/db";
import { body, fail, MAX_BLOB } from "@/server/http";
import type { VaultMeta } from "@/lib/types";

export const dynamic = "force-dynamic";

// The server stores the vault but can't open it: everything in it is encrypted in the browser.
export function GET() {
  return NextResponse.json({ meta: getVaultMeta(), items: listVaultItems() });
}

/** Creates the vault, once. */
export async function POST(req: Request) {
  const { meta } = (await body(req)) as { meta?: VaultMeta };
  const k = meta?.kdf;
  const valid =
    meta?.v === 1 &&
    k?.name === "argon2id" &&
    typeof k.salt === "string" &&
    k.salt.length <= 100 &&
    [k.memoryKiB, k.iterations, k.parallelism].every((n) => Number.isInteger(n) && n > 0 && n <= 4_194_304) &&
    typeof meta.wrappedKey === "string" &&
    meta.wrappedKey.length <= MAX_BLOB;
  if (!valid) return fail("Coffre invalide");
  const clean: VaultMeta = { v: 1, kdf: { name: "argon2id", salt: k.salt, memoryKiB: k.memoryKiB, iterations: k.iterations, parallelism: k.parallelism }, wrappedKey: meta.wrappedKey };
  if (!createVaultMeta(clean)) return fail("Le coffre existe déjà", 409);
  return NextResponse.json({ meta: clean }, { status: 201 });
}
