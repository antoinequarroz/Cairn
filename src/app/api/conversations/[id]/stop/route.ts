import { NextResponse } from "next/server";
import { stopChat } from "@/server/chat";

type Ctx = { params: Promise<{ id: string }> };

/** Stops the answer being written. What it already wrote stays in the discussion. */
export async function POST(_: Request, { params }: Ctx) {
  return NextResponse.json({ stopped: stopChat((await params).id) });
}
