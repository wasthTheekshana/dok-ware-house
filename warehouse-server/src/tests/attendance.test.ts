/// <reference types="jest" />
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../middleware/authMiddleware', () => ({
    authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = { id: 1, role: 'system_admin' };
        next();
    },
}));

jest.mock('../middleware/permissionMiddleware', () => ({
    requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../db/dbUtils', () => {
    const execute = jest.fn();
    return {
        execute,
        withTransaction: jest.fn(async (fn: any) => fn(execute)),
    };
});

import attendanceRoutes from '../routes/attendanceRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/attendance', attendanceRoutes);

const VALID_BODY = {
    warehouse_id: 1,
    attendance_date: '2026-09-05',
    entries: [
        { staff_id: 1, status: 'present', in_time: '08:00', out_time: '17:00' },
        { staff_id: 2, status: 'absent' },
    ],
};

describe('POST /api/attendance/bulk-mark', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('upserts every entry in one transaction when all staff belong to warehouse_id', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }, { ID: 2 }] }) // staff existence check
            .mockResolvedValueOnce({ rows: [{ ID: 10, STAFF_ID: 1, STATUS: 'present' }] }) // upsert 1
            .mockResolvedValueOnce({ rows: [{ ID: 11, STAFF_ID: 2, STATUS: 'absent' }] }); // upsert 2

        const res = await request(app).post('/api/attendance/bulk-mark').send(VALID_BODY);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(mockExecute.mock.calls[1][0]).toMatch(/INSERT INTO attendance/);
        expect(mockExecute.mock.calls[1][0]).toMatch(/ON CONFLICT \(staff_id, attendance_date\)/);
    });

    it('rejects the whole batch when one staff_id does not belong to warehouse_id', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1 }] }); // only 1 of 2 staff_ids matched

        const res = await request(app).post('/api/attendance/bulk-mark').send(VALID_BODY);

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/do not belong to warehouse_id/);
        // Only the existence check ran — no INSERT/upsert attempted for any entry
        expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid status value', async () => {
        const res = await request(app).post('/api/attendance/bulk-mark').send({
            ...VALID_BODY,
            entries: [{ staff_id: 1, status: 'on_vacation' }],
        });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('GET /api/attendance', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('filters by staff_id and date range', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/attendance?staff_id=1&from=2026-09-01&to=2026-09-30');

        expect(res.status).toBe(200);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND a\.staff_id = :staff_id/);
        expect(query).toMatch(/AND a\.attendance_date >= :from/);
        expect(query).toMatch(/AND a\.attendance_date <= :to/);
        expect(params).toMatchObject({ staff_id: '1', from: '2026-09-01', to: '2026-09-30' });
    });
});

describe('GET /api/attendance/summary', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('computes per-status counts for the given month', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // staff existence check
            .mockResolvedValueOnce({ rows: [
                { STATUS: 'present', COUNT: 20 },
                { STATUS: 'absent', COUNT: 2 },
                { STATUS: 'leave', COUNT: 1 },
            ] });

        const res = await request(app).get('/api/attendance/summary?staff_id=1&year=2026&month=9');

        expect(res.status).toBe(200);
        expect(res.body.counts).toEqual({ present: 20, absent: 2, half_day: 0, leave: 1 });
    });

    it('returns 404 when the staff member does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/attendance/summary?staff_id=999&year=2026&month=9');

        expect(res.status).toBe(404);
    });
});

describe('POST /api/attendance/bulk-mark — warehouse scoping for warehouse_admin', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('rejects a warehouse_id outside the warehouse_admin\'s warehouse_ids before touching the database', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 9, role: 'warehouse_admin', warehouse_ids: [2] };
                next();
            },
        }));
        jest.doMock('../middleware/permissionMiddleware', () => ({
            requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../db/dbUtils', () => {
            const execute = jest.fn();
            return { execute, withTransaction: jest.fn(async (fn: any) => fn(execute)) };
        });

        const scopedRoutes = require('../routes/attendanceRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/attendance', scopedRoutes);

        const res = await request(scopedApp).post('/api/attendance/bulk-mark').send({ ...VALID_BODY, warehouse_id: 1 });

        expect(res.status).toBe(400);
        const { execute: scopedExecute } = require('../db/dbUtils');
        expect(scopedExecute).not.toHaveBeenCalled();

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
