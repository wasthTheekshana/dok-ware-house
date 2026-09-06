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

jest.mock('../db/dbUtils', () => ({ execute: jest.fn() }));

import payrollRoutes from '../routes/payrollRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/payroll', payrollRoutes);

describe('POST /api/payroll', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('creates a draft, pre-filling basic_pay and deductions from attendance', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, WAREHOUSE_ID: 1, BASIC_SALARY: 30000 }] }) // staff lookup
            .mockResolvedValueOnce({ rows: [] }) // duplicate check
            .mockResolvedValueOnce({ rows: [{ COUNT: 2 }] }) // absent days
            .mockResolvedValueOnce({ rows: [{ ID: 10, STAFF_ID: 1, BASIC_PAY: 30000, DEDUCTIONS: 2000, NET_SALARY: 28000, STATUS: 'draft' }] }); // insert

        const res = await request(app).post('/api/payroll').send({ staff_id: 1, month: 9, year: 2026 });

        expect(res.status).toBe(201);
        const [, insertParams] = mockExecute.mock.calls[3];
        expect(insertParams.basic_pay).toBe(30000);
        expect(insertParams.deductions).toBe(2000); // (30000/30) * 2
        expect(insertParams.net_salary).toBe(28000);
    });

    it('returns 409 when a non-reversal payroll record already exists for that staff/period', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, WAREHOUSE_ID: 1, BASIC_SALARY: 30000 }] })
            .mockResolvedValueOnce({ rows: [{ ID: 5 }] }); // duplicate found

        const res = await request(app).post('/api/payroll').send({ staff_id: 1, month: 9, year: 2026 });

        expect(res.status).toBe(409);
        expect(mockExecute).toHaveBeenCalledTimes(2); // no attendance query, no insert
    });

    it('returns 404 when the staff member does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).post('/api/payroll').send({ staff_id: 999, month: 9, year: 2026 });

        expect(res.status).toBe(404);
    });
});

describe('GET /api/payroll', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('filters by staff_id, month, year, and status', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/payroll?staff_id=1&month=9&year=2026&status=draft');

        expect(res.status).toBe(200);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND p\.staff_id = :staff_id/);
        expect(query).toMatch(/AND p\.month = :month/);
        expect(query).toMatch(/AND p\.year = :year/);
        expect(query).toMatch(/AND p\.status = :status/);
        expect(params).toMatchObject({ staff_id: '1', month: '9', year: '2026', status: 'draft' });
    });
});

describe('PUT /api/payroll/:id', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('edits a draft and recomputes net_salary', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, BASIC_PAY: 30000, OT_AMOUNT: 0, DEDUCTIONS: 2000, EPF_EMPLOYEE: 0, STATUS: 'draft' }] }) // existence+status check
            .mockResolvedValueOnce({ rows: [{ ID: 1, OT_AMOUNT: 1500, NET_SALARY: 29500 }] }); // update

        const res = await request(app).put('/api/payroll/1').send({ ot_amount: 1500 });

        expect(res.status).toBe(200);
        const [, updateParams] = mockExecute.mock.calls[1];
        expect(updateParams.net_salary).toBe(29500); // 30000 + 1500 - 2000 - 0
    });

    it('returns 404 when the record is approved (never editable)', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] }); // status filter excludes approved rows

        const res = await request(app).put('/api/payroll/1').send({ ot_amount: 1500 });

        expect(res.status).toBe(404);
    });

    it('rejects a body with no fields to update', async () => {
        const res = await request(app).put('/api/payroll/1').send({});

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('POST /api/payroll — warehouse scoping for warehouse_admin', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('returns 404 when the staff member is outside the warehouse_admin\'s warehouse_ids', async () => {
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
            execute.mockResolvedValueOnce({ rows: [] });
            return { execute };
        });

        const scopedRoutes = require('../routes/payrollRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/payroll', scopedRoutes);

        const res = await request(scopedApp).post('/api/payroll').send({ staff_id: 1, month: 9, year: 2026 });

        expect(res.status).toBe(404);
        const { execute: scopedExecute } = require('../db/dbUtils');
        const [query, params] = scopedExecute.mock.calls[0];
        expect(query).toMatch(/AND warehouse_id = ANY\(:warehouse_ids\)/);
        expect(params.warehouse_ids).toEqual([2]);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
