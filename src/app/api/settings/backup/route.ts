import { NextResponse } from "next/server";
import { BACKUP_LATE_MS, readBackupStatus } from "@/server/backup-status";

export const dynamic = "force-dynamic";

export function GET() {
  const status = readBackupStatus();
  const lastOk = status?.ok ? status.at : status?.lastOkAt;
  return NextResponse.json({ status, late: !lastOk || Date.now() - new Date(lastOk).getTime() > BACKUP_LATE_MS });
}
