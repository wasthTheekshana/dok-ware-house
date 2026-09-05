/// <reference types="jest" />
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../middleware/authMiddleware', () => ({
    authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = { id: 1, role: 'system_admin' };
        next();
    },
    requireRole: (_roles: string[]) => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../middleware/permissionMiddleware', () => ({ requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next() }));

jest.mock('../db/dbUtils', () => ({ execute: jest.fn() }));

import invoiceRoutes from '../routes/invoiceRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/invoices', invoiceRoutes);

const VALID_BODY = { department_id: 1, period_from: '2026-07-01', period_to: '2026-07-31' };

const DEPT_ROW = {
    ID: 1, COMPANY_ID: 1, DEPARTMENT_NAME: 'CASH DEPT', COMPANY_NAME: 'AB Securitas',
    PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20,
};

describe('POST /api/invoices/preview', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('computes a full breakdown without persisting anything', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [DEPT_ROW] })
            .mockResolvedValueOnce({ rows: [{ EVENT_TYPE: 'archived', TOTAL: 100 }, { EVENT_TYPE: 'retrieved', TOTAL: 20 }] });

        const res = await request(app).post('/api/invoices/preview').send(VALID_BODY);

        expect(res.status).toBe(200);
        expect(res.body.SUBTOTAL).toBe(5900); // 100*50 + 20*45
        expect(res.body.TOTAL_AMOUNT).toBeGreaterThan(res.body.SUBTOTAL);
        expect(mockExecute).toHaveBeenCalledTimes(2); // no INSERT
    });

    it('returns 404 when the department does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).post('/api/invoices/preview').send(VALID_BODY);

        expect(res.status).toBe(404);
    });

    it('rejects a body missing period_from', async () => {
        const res = await request(app).post('/api/invoices/preview').send({ department_id: 1, period_to: '2026-07-31' });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('rejects a period_from after period_to', async () => {
        const res = await request(app).post('/api/invoices/preview').send({ department_id: 1, period_from: '2026-07-31', period_to: '2026-07-01' });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('POST /api/invoices', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('recomputes and saves an invoice, ignoring any client-submitted amounts', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [DEPT_ROW] })
            .mockResolvedValueOnce({ rows: [{ EVENT_TYPE: 'archived', TOTAL: 100 }, { EVENT_TYPE: 'retrieved', TOTAL: 20 }] })
            .mockResolvedValueOnce({ rows: [{ ID: 1, DEPARTMENT_ID: 1, SUBTOTAL: 5900, TOTAL_AMOUNT: 7139.15 }] });

        const res = await request(app).post('/api/invoices').send({ ...VALID_BODY, total_amount: 1 });

        expect(res.status).toBe(201);
        expect(res.body.ID).toBe(1);
        const insertCall = mockExecute.mock.calls[2];
        expect(insertCall[0]).toMatch(/INSERT INTO invoices/);
        expect(insertCall[1].subtotal).toBe(5900); // server-recomputed, not the submitted "1"
    });

    it('returns 404 when the department does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).post('/api/invoices').send(VALID_BODY);

        expect(res.status).toBe(404);
    });

    it('returns 409 when an invoice for this department and period already exists', async () => {
        const err: any = new Error('Duplicate key');
        err.code = '23505';
        mockExecute
            .mockResolvedValueOnce({ rows: [DEPT_ROW] })
            .mockResolvedValueOnce({ rows: [{ EVENT_TYPE: 'archived', TOTAL: 100 }] })
            .mockRejectedValueOnce(err);

        const res = await request(app).post('/api/invoices').send(VALID_BODY);

        expect(res.status).toBe(409);
    });
});

describe('GET /api/invoices', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('filters by department_id', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/invoices?department_id=1');

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[0][0]).toMatch(/AND department_id = :department_id/);
    });
});

describe('DELETE /api/invoices/:id', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('deletes an invoice', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1 }] });

        const res = await request(app).delete('/api/invoices/1');

        expect(res.status).toBe(200);
    });

    it('returns 404 when missing', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).delete('/api/invoices/999');

        expect(res.status).toBe(404);
    });
});

describe('Invoices API — requirePermission(view_invoices) on GET (real requirePermission)', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('GET /api/invoices returns 403 when user lacks view_invoices', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 1, role: 'warehouse_admin' };
                next();
            },
            requireRole: (_roles: string[]) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../middleware/permissionMiddleware', () => jest.requireActual('../middleware/permissionMiddleware'));
        jest.doMock('../db/dbUtils', () => ({ execute: mockExecute }));

        mockExecute.mockResolvedValueOnce({ rows: [] }); // no permission overrides

        const testRoutes = require('../routes/invoiceRoutes').default;
        const testApp = express();
        testApp.use(express.json());
        testApp.use('/api/invoices', testRoutes);

        const res = await request(testApp).get('/api/invoices');

        expect(res.status).toBe(403);
        expect(mockExecute).toHaveBeenCalled();

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
