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

    it('returns 404 if the record was approved between the existence check and the update (race)', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, BASIC_PAY: 30000, OT_AMOUNT: 0, DEDUCTIONS: 2000, EPF_EMPLOYEE: 0, STATUS: 'draft' }] }) // existence+status check passes
            .mockResolvedValueOnce({ rows: [] }); // UPDATE's own WHERE clause excludes it (status changed concurrently)

        const res = await request(app).put('/api/payroll/1').send({ ot_amount: 1500 });

        expect(res.status).toBe(404);
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

describe('POST /api/payroll/:id/submit', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('moves a draft to pending_approval', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, STATUS: 'pending_approval' }] });

        const res = await request(app).post('/api/payroll/1/submit');

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[0][0]).toMatch(/status = 'pending_approval'/);
        expect(mockExecute.mock.calls[0][0]).toMatch(/status IN \('draft', 'rejected'\)/);
    });

    it('returns 404 when the record is not draft/rejected', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).post('/api/payroll/1/submit');

        expect(res.status).toBe(404);
    });
});

describe('POST /api/payroll/:id/approve', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('approves a pending_approval record as system_admin', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, STATUS: 'approved', APPROVED_BY: 1 }] });

        const res = await request(app).post('/api/payroll/1/approve');

        expect(res.status).toBe(200);
    });

    it('returns 404 when the record is not pending_approval', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).post('/api/payroll/1/approve');

        expect(res.status).toBe(404);
    });

    it('rejects a warehouse_admin attempting to approve, even though they hold manage_payroll', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 9, role: 'warehouse_admin', warehouse_ids: [1] };
                next();
            },
        }));
        jest.doMock('../middleware/permissionMiddleware', () => ({
            requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../db/dbUtils', () => ({ execute: jest.fn() }));

        const scopedRoutes = require('../routes/payrollRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/payroll', scopedRoutes);

        const res = await request(scopedApp).post('/api/payroll/1/approve');

        expect(res.status).toBe(403);
        const { execute: scopedExecute } = require('../db/dbUtils');
        expect(scopedExecute).not.toHaveBeenCalled();

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});

describe('POST /api/payroll/:id/reject', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('rejects a pending_approval record as finance_officer', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 3, role: 'finance_officer' };
                next();
            },
        }));
        jest.doMock('../middleware/permissionMiddleware', () => ({
            requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../db/dbUtils', () => {
            const execute = jest.fn();
            execute.mockResolvedValueOnce({ rows: [{ ID: 1, STATUS: 'rejected' }] });
            return { execute };
        });

        const scopedRoutes = require('../routes/payrollRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/payroll', scopedRoutes);

        const res = await request(scopedApp).post('/api/payroll/1/reject');

        expect(res.status).toBe(200);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});

describe('POST /api/payroll/:id/reverse', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('inserts a negative-mirror row referencing the original', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 5, STAFF_ID: 1, WAREHOUSE_ID: 1, MONTH: 9, YEAR: 2026, BASIC_PAY: 30000, OT_AMOUNT: 1500, DEDUCTIONS: 2000, EPF_EMPLOYEE: 2400, EPF_EMPLOYER: 3600, ETF: 900, NET_SALARY: 27100 }] })
            .mockResolvedValueOnce({ rows: [{ ID: 6, REVERSES_PAYROLL_ID: 5, NET_SALARY: -27100 }] });

        const res = await request(app).post('/api/payroll/5/reverse');

        expect(res.status).toBe(201);
        const [, insertParams] = mockExecute.mock.calls[1];
        expect(insertParams.basic_pay).toBe(-30000);
        expect(insertParams.ot_amount).toBe(-1500);
        expect(insertParams.deductions).toBe(-2000);
        expect(insertParams.epf_employee).toBe(-2400);
        expect(insertParams.epf_employer).toBe(-3600);
        expect(insertParams.etf).toBe(-900);
        expect(insertParams.net_salary).toBe(-27100);
        expect(insertParams.reverses_payroll_id).toBe(5);
    });

    it('rejects reversing a non-approved record', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).post('/api/payroll/5/reverse');

        expect(res.status).toBe(400);
    });

    it('returns 409 when the record has already been reversed', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 5, STAFF_ID: 1, WAREHOUSE_ID: 1, MONTH: 9, YEAR: 2026, BASIC_PAY: 30000, OT_AMOUNT: 0, DEDUCTIONS: 0, EPF_EMPLOYEE: 0, EPF_EMPLOYER: 0, ETF: 0, NET_SALARY: 30000 }] })
            .mockRejectedValueOnce({ code: '23505' });

        const res = await request(app).post('/api/payroll/5/reverse');

        expect(res.status).toBe(409);
    });
});

describe('GET /api/payroll/report', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('returns one row per warehouse with net salary and employer cost totals', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [
            { WAREHOUSE_ID: 1, WAREHOUSE_NAME: 'Dagonna', TOTAL_NET_SALARY: 28000, TOTAL_EMPLOYER_COST: 33800 },
            { WAREHOUSE_ID: 2, WAREHOUSE_NAME: 'Warehouse B', TOTAL_NET_SALARY: 0, TOTAL_EMPLOYER_COST: 0 },
        ] });

        const res = await request(app).get('/api/payroll/report?year=2026&month=9');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/LEFT JOIN payroll p ON p\.warehouse_id = w\.id AND p\.status = 'approved'/);
        expect(params).toMatchObject({ year: 2026, month: 9 });
    });
});

describe('GET /api/payroll/report — warehouse scoping for warehouse_admin', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('scopes results to the warehouse_admin\'s own warehouse', async () => {
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
            execute.mockResolvedValueOnce({ rows: [{ WAREHOUSE_ID: 2, WAREHOUSE_NAME: 'Warehouse B', TOTAL_NET_SALARY: 0, TOTAL_EMPLOYER_COST: 0 }] });
            return { execute };
        });

        const scopedRoutes = require('../routes/payrollRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/payroll', scopedRoutes);

        const res = await request(scopedApp).get('/api/payroll/report?year=2026&month=9');

        expect(res.status).toBe(200);
        const { execute: scopedExecute } = require('../db/dbUtils');
        const [query, params] = scopedExecute.mock.calls[0];
        expect(query).toMatch(/AND w\.id = ANY\(:warehouse_ids\)/);
        expect(params.warehouse_ids).toEqual([2]);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
