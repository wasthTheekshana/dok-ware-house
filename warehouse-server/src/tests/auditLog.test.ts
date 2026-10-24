// warehouse-server/src/tests/auditLog.test.ts
import { logAudit } from '../utils/auditLog';

describe('logAudit', () => {
    it('inserts with the given table_name, record_id, action, and actor_id', async () => {
        const exec = jest.fn().mockResolvedValue({ rows: [] });
        await logAudit(exec as any, 'invoices', 7, 'create', 3, null, { ID: 7 });
        const [sql, params] = exec.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO audit_log/);
        expect(params).toMatchObject({ table_name: 'invoices', record_id: 7, action: 'create', actor_id: 3 });
    });

    it('serializes a null before_value to SQL NULL, not the string "null"', async () => {
        const exec = jest.fn().mockResolvedValue({ rows: [] });
        await logAudit(exec as any, 'invoices', 7, 'create', 3, null, { ID: 7 });
        const [, params] = exec.mock.calls[0];
        expect(params.before_value).toBeNull();
    });

    it('serializes a null after_value to SQL NULL, not the string "null"', async () => {
        const exec = jest.fn().mockResolvedValue({ rows: [] });
        await logAudit(exec as any, 'warehouse_expenses', 7, 'delete', 3, { ID: 7 }, null);
        const [, params] = exec.mock.calls[0];
        expect(params.after_value).toBeNull();
    });

    it('JSON-serializes a non-null before/after value', async () => {
        const exec = jest.fn().mockResolvedValue({ rows: [] });
        await logAudit(exec as any, 'staff', 7, 'update', 3, { ID: 7, NAME: 'A' }, { ID: 7, NAME: 'B' });
        const [, params] = exec.mock.calls[0];
        expect(JSON.parse(params.before_value)).toEqual({ ID: 7, NAME: 'A' });
        expect(JSON.parse(params.after_value)).toEqual({ ID: 7, NAME: 'B' });
    });
});
