import { TxExecutor } from '../db/dbUtils';

export type AuditAction = 'create' | 'update' | 'delete' | 'reverse';

export async function logAudit(
    exec: TxExecutor,
    tableName: string,
    recordId: number,
    action: AuditAction,
    actorId: number | null,
    beforeValue: unknown,
    afterValue: unknown
): Promise<void> {
    await exec(
        `INSERT INTO audit_log (table_name, record_id, action, actor_id, before_value, after_value)
         VALUES (:table_name, :record_id, :action, :actor_id, :before_value, :after_value)`,
        {
            table_name: tableName,
            record_id: recordId,
            action,
            actor_id: actorId,
            before_value: beforeValue == null ? null : JSON.stringify(beforeValue),
            after_value: afterValue == null ? null : JSON.stringify(afterValue),
        }
    );
}
