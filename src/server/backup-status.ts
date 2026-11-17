// What deploy/backup.sh last reported, in DATA_DIR/backup-status.json. The script runs on the VPS, outside
// the app: this file is the only way Réglages can tell whether last night's backup worked.
import fs from "node:fs";
import path from "node:path";

export type BackupStatus = {
  ok: boolean;
  /** When the script finished (ISO). */
  at: string;
  file?: string;
  bytes?: number;
  /** Copied off the VPS (rclone), or only kept locally. */
  offsite?: boolean;
  error?: string;
  /** Last successful backup, kept when a later run fails. */
  lastOkAt?: string;
};

/** A backup older than this is reported as late: the nightly cron has probably stopped. */
export const BACKUP_LATE_MS = 36 * 3600_000;

export function readBackupStatus(): BackupStatus | null {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(path.resolve(process.env.DATA_DIR ?? "./data"), "backup-status.json"), "utf8")) as BackupStatus;
    return typeof data.at === "string" && typeof data.ok === "boolean" ? data : null;
  } catch {
    return null;
  }
}
