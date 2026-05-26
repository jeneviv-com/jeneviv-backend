import { db } from "../db/index.js";
import { auditLogs } from "../db/schema/platform.js";
import { newId } from "./short-code.js";

export interface RecordAuditArgs {
  actorUid: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

export async function recordAudit(args: RecordAuditArgs): Promise<void> {
  await db.insert(auditLogs).values({
    id: newId(),
    actorUid: args.actorUid,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    metadata: args.metadata ?? null,
  });
}
