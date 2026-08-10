import { sql } from "../db.ts";
import { log } from "../log.ts";

export interface AuditEntry {
  accountId?: string | null;
  actor?: string | null;
  ip?: string | null;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown>;
  outcome?: "ok" | "denied" | "failed";
}

/**
 * Appends to the audit log.
 *
 * Never throws. An audit write that fails must not also fail the operation it is
 * recording — but it must be impossible to miss, so it escalates to an error log line
 * where the alerting can see it. The table itself is append-only (trigger plus revoked
 * grants), so nothing downstream can quietly rewrite what lands here.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await sql`
      insert into audit_log (account_id, actor, ip, action, target, detail, outcome)
      values (
        ${entry.accountId ?? null},
        ${entry.actor ?? null},
        ${entry.ip ?? null},
        ${entry.action},
        ${entry.target ?? null},
        ${sql.json(JSON.parse(JSON.stringify(entry.detail ?? {})))},
        ${entry.outcome ?? "ok"}
      )
    `;
  } catch (err) {
    log.error("AUDIT WRITE FAILED", {
      action: entry.action,
      target: entry.target,
      error: (err as Error).message,
    });
  }
}
