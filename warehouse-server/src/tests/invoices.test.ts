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
    CURRENT_BOX_COUNT: 200, PRICE_PER_BOX_STORED_MONTHLY: 10,
};

describe('POST /api/invoices/preview', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('computes a full breakdown without persisting anything, including storage rental', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [DEPT_ROW] })
            .mockResolvedValueOnce({ rows: [{ EVENT_TYPE: 'archived', TOTAL: 100 }, { EVENT_TYPE: 'retrieved', TOTAL: 20 }] });

        const res = await request(app).post('/api/invoices/preview').send(VALID_BODY);

        expect(res.status).toBe(200);
        // 100*50 + 20*45 + 200*10 = 5000 + 900 + 2000 = 7900
        expect(res.body.SUBTOTAL).toBe(7900);
        expect(res.body.BOX_COUNT_AT_BILLING).toBe(200);
        expect(res.body.STORAGE_RENTAL_AMOUNT).toBe(2000);
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
            .mockResolvedValueOnce({ rows: [{ ID: 1, DEPARTMENT_ID: 1, SUBTOTAL: 7900, TOTAL_AMOUNT: 9563.15 }] });

        const res = await request(app).post('/api/invoices').send({ ...VALID_BODY, total_amount: 1 });

        expect(res.status).toBe(201);
        expect(res.body.ID).toBe(1);
        const insertCall = mockExecute.mock.calls[2];
        expect(insertCall[0]).toMatch(/INSERT INTO invoices/);
        expect(insertCall[1].subtotal).toBe(7900); // server-recomputed, not the submitted "1"
        expect(insertCall[1].box_count_at_billing).toBe(200);
        expect(insertCall[1].storage_rental_amount).toBe(2000);
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

describe('POST /api/invoices/:id/reverse', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    const ORIGINAL_ROW = {
        ID: 1, DEPARTMENT_ID: 1, COMPANY_ID: 1, DEPARTMENT_NAME: 'CASH DEPT', COMPANY_NAME: 'AB Securitas',
        PERIOD_FROM: '2026-07-01', PERIOD_TO: '2026-07-31',
        ARCHIVED_COUNT: 100, RETRIEVED_COUNT: 20, EMPTY_CARTON_COUNT: 5,
        PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20,
        BOX_COUNT_AT_BILLING: 200, STORAGE_RENTAL_AMOUNT: 2000,
        SUBTOTAL: 7900, SSCL_AMOUNT: 202.56, VAT_AMOUNT: 1458.46, TOTAL_AMOUNT: 9561.02,
        REVERSES_INVOICE_ID: null,
    };

    it('creates a negated mirror row linked to the original', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [ORIGINAL_ROW] })
            .mockResolvedValueOnce({ rows: [{ ID: 2, REVERSES_INVOICE_ID: 1 }] });

        const res = await request(app).post('/api/invoices/1/reverse');

        expect(res.status).toBe(201);
        const insertCall = mockExecute.mock.calls[1];
        expect(insertCall[0]).toMatch(/INSERT INTO invoices/);
        expect(insertCall[1].archived_count).toBe(-100);
        expect(insertCall[1].retrieved_count).toBe(-20);
        expect(insertCall[1].empty_carton_count).toBe(-5);
        expect(insertCall[1].box_count_at_billing).toBe(200); // copied unchanged, not negated
        expect(insertCall[1].storage_rental_amount).toBe(-2000); // negated like other monetary fields
        expect(insertCall[1].subtotal).toBe(-7900);
        expect(insertCall[1].sscl_amount).toBe(-202.56);
        expect(insertCall[1].vat_amount).toBe(-1458.46);
        expect(insertCall[1].total_amount).toBe(-9561.02);
        expect(insertCall[1].reverses_invoice_id).toBe(1);
        expect(insertCall[1].period_from).toBe('2026-07-01');
        expect(insertCall[1].period_to).toBe('2026-07-31');
    });

    it('returns 400 when the invoice does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).post('/api/invoices/999/reverse');

        expect(res.status).toBe(400);
    });

    it('returns 400 when attempting to reverse an already-reversed invoice (a reversal row)', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] }); // WHERE reverses_invoice_id IS NULL excludes it

        const res = await request(app).post('/api/invoices/2/reverse');

        expect(res.status).toBe(400);
    });

    it('returns 409 when the reversal collides with an existing one', async () => {
        const err: any = new Error('Duplicate key');
        err.code = '23505';
        mockExecute
            .mockResolvedValueOnce({ rows: [ORIGINAL_ROW] })
            .mockRejectedValueOnce(err);

        const res = await request(app).post('/api/invoices/1/reverse');

        expect(res.status).toBe(409);
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
