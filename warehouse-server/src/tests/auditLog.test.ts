// warehouse-server/src/tests/auditLog.test.ts
import { logAudit } from '../utils/auditLog';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../middleware/authMiddleware', () => ({
    authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = (req.headers['x-test-role'] ? { id: 1, role: req.headers['x-test-role'] } : { id: 1, role: 'system_admin' });
        next();
    },
}));
jest.mock('../db/dbUtils', () => ({ execute: jest.fn(), withTransaction: jest.fn() }));

import auditLogRoutes from '../routes/auditLogRoutes';
import { execute } from '../db/dbUtils';
const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/audit-log', auditLogRoutes);

describe('GET /api/audit-log', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('returns 403 for a finance_officer', async () => {
        const res = await request(app).get('/api/audit-log').set('x-test-role', 'finance_officer');
        expect(res.status).toBe(403);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('returns 403 for a warehouse_admin', async () => {
        const res = await request(app).get('/api/audit-log').set('x-test-role', 'warehouse_admin');
        expect(res.status).toBe(403);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('returns 200 with rows for a system_admin', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, TABLE_NAME: 'invoices', RECORD_ID: 7, ACTION: 'create' }] });
        const res = await request(app).get('/api/audit-log');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
    });

    it('filters by table_name and record_id', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });
        await request(app).get('/api/audit-log?table_name=invoices&record_id=7');
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND al\.table_name = :table_name/);
        expect(query).toMatch(/AND al\.record_id = :record_id/);
        expect(params).toMatchObject({ table_name: 'invoices', record_id: '7' });
    });

    it('joins users to include the actor username', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });
        await request(app).get('/api/audit-log');
        const [query] = mockExecute.mock.calls[0];
        expect(query).toMatch(/JOIN users/);
    });

    it('filters "to" inclusively through the end of the given day, not midnight at its start', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/api/audit-log?to=2026-10-24');
        expect(res.status).toBe(200);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND al\.created_at < :to::date \+ interval '1 day'/);
        expect(params).toMatchObject({ to: '2026-10-24' });
    });

    it('returns 400 for a malformed "from" date instead of hitting the database', async () => {
        const res = await request(app).get('/api/audit-log?from=not-a-date');
        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('returns 400 for a malformed "to" date instead of hitting the database', async () => {
        const res = await request(app).get('/api/audit-log?to=2026/10/24');
        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

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
