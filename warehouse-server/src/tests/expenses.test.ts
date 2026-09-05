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

import expenseRoutes from '../routes/expenseRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/expenses', expenseRoutes);

const VALID_BODY = { warehouse_id: 1, expense_date: '2026-09-01', transport_amount: 500, fuel_amount: 1000 };

describe('POST /api/expenses', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('creates an entry with the given amounts, defaulting missing categories to 0', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, WAREHOUSE_ID: 1, EXPENSE_DATE: '2026-09-01', TRANSPORT_AMOUNT: 500, FUEL_AMOUNT: 1000, LABOUR_AMOUNT: 0, MEALS_AMOUNT: 0, OTHER_AMOUNT: 0 }] });

        const res = await request(app).post('/api/expenses').send(VALID_BODY);

        expect(res.status).toBe(201);
        const [, params] = mockExecute.mock.calls[0];
        expect(params).toMatchObject({ warehouse_id: 1, expense_date: '2026-09-01', transport_amount: 500, fuel_amount: 1000, labour_amount: 0, meals_amount: 0, other_amount: 0 });
    });

    it('returns 409 when an entry already exists for that warehouse and date', async () => {
        mockExecute.mockRejectedValueOnce({ code: '23505' });

        const res = await request(app).post('/api/expenses').send(VALID_BODY);

        expect(res.status).toBe(409);
    });

    it('rejects a negative amount', async () => {
        const res = await request(app).post('/api/expenses').send({ ...VALID_BODY, transport_amount: -5 });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('GET /api/expenses', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('filters by warehouse_id and date range', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/expenses?warehouse_id=1&from=2026-09-01&to=2026-09-30');

        expect(res.status).toBe(200);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND we\.warehouse_id = :warehouse_id/);
        expect(query).toMatch(/AND we\.expense_date >= :from/);
        expect(query).toMatch(/AND we\.expense_date <= :to/);
        expect(params).toMatchObject({ warehouse_id: '1', from: '2026-09-01', to: '2026-09-30' });
    });
});

describe('PUT /api/expenses/:id', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('updates the given fields', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // existence check
            .mockResolvedValueOnce({ rows: [{ ID: 1, TRANSPORT_AMOUNT: 750 }] }); // UPDATE

        const res = await request(app).put('/api/expenses/1').send({ transport_amount: 750 });

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[1][0]).toMatch(/UPDATE warehouse_expenses SET transport_amount = :transport_amount, updated_at = now\(\)/);
    });

    it('returns 404 when the entry does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).put('/api/expenses/999').send({ transport_amount: 750 });

        expect(res.status).toBe(404);
    });

    it('rejects a body with no fields to update', async () => {
        const res = await request(app).put('/api/expenses/1').send({});

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('DELETE /api/expenses/:id', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('deletes an existing entry', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] })
            .mockResolvedValueOnce({ rows: [] });

        const res = await request(app).delete('/api/expenses/1');

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[1][0]).toMatch(/DELETE FROM warehouse_expenses/);
    });

    it('returns 404 when the entry does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).delete('/api/expenses/999');

        expect(res.status).toBe(404);
    });
});

describe('POST /api/expenses — warehouse scoping for warehouse_admin', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('rejects creating an entry for a warehouse outside the warehouse_admin\'s warehouse_ids', async () => {
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
        jest.doMock('../db/dbUtils', () => ({ execute: jest.fn() }));

        const scopedRoutes = require('../routes/expenseRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/expenses', scopedRoutes);

        const res = await request(scopedApp).post('/api/expenses').send({ ...VALID_BODY, warehouse_id: 1 });

        expect(res.status).toBe(400);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});

describe('GET /api/expenses — warehouse scoping for warehouse_admin', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('scopes results to the warehouse_admin\'s warehouse_ids', async () => {
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

        const scopedRoutes = require('../routes/expenseRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/expenses', scopedRoutes);

        const res = await request(scopedApp).get('/api/expenses');

        expect(res.status).toBe(200);
        const { execute: scopedExecute } = require('../db/dbUtils');
        const [query, params] = scopedExecute.mock.calls[0];
        expect(query).toMatch(/AND we\.warehouse_id = ANY\(:warehouse_ids\)/);
        expect(params.warehouse_ids).toEqual([2]);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
