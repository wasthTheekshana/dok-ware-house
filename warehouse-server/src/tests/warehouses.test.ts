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

jest.mock('../middleware/permissionMiddleware', () => ({
    requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../db/dbUtils', () => ({ execute: jest.fn() }));

import warehouseRoutes from '../routes/warehouseRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/warehouses', warehouseRoutes);

describe('Warehouses API', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('GET /api/warehouses returns the list', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, NAME: 'Dagonna', DEPARTMENT_COUNT: 3 }] });

        const res = await request(app).get('/api/warehouses');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].NAME).toBe('Dagonna');
    });

    it('GET /api/warehouses/:id returns warehouse with departments', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, NAME: 'Dagonna' }] })
            .mockResolvedValueOnce({ rows: [{ ID: 10, NAME: 'CASH DEPT', COMPANY_NAME: 'AB Securitas', CURRENT_BOX_COUNT: 30 }] });

        const res = await request(app).get('/api/warehouses/1');

        expect(res.status).toBe(200);
        expect(res.body.DEPARTMENTS).toHaveLength(1);
        expect(res.body.DEPARTMENTS[0].NAME).toBe('CASH DEPT');
    });

    it('GET /api/warehouses/:id returns 404 when missing', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/warehouses/999');

        expect(res.status).toBe(404);
    });

    it('POST /api/warehouses rejects a body with no name', async () => {
        const res = await request(app).post('/api/warehouses').send({ code: 'DGN' });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('POST /api/warehouses creates a warehouse', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, NAME: 'Dagonna' }] });

        const res = await request(app).post('/api/warehouses').send({ name: 'Dagonna' });

        expect(res.status).toBe(201);
        expect(res.body.NAME).toBe('Dagonna');
    });

    it('PUT /api/warehouses/:id updates a warehouse', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, NAME: 'Dagonna Updated' }] });

        const res = await request(app).put('/api/warehouses/1').send({ name: 'Dagonna Updated' });

        expect(res.status).toBe(200);
        expect(res.body.NAME).toBe('Dagonna Updated');
    });

    it('PUT /api/warehouses/:id returns 404 when missing', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).put('/api/warehouses/999').send({ name: 'X' });

        expect(res.status).toBe(404);
    });
});

describe('Warehouses API — admin-only write gating (real requirePermission)', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('POST /api/warehouses returns 403 for a non-admin user', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 1, role: 'warehouse_admin' };
                next();
            },
        }));
        jest.doMock('../db/dbUtils', () => ({ execute: mockExecute }));
        // The top-of-file jest.mock('../middleware/permissionMiddleware', ...) pass-through
        // persists across jest.resetModules() unless explicitly overridden here — this test
        // needs the REAL requirePermission, not the pass-through.
        jest.doMock('../middleware/permissionMiddleware', () => jest.requireActual('../middleware/permissionMiddleware'));

        mockExecute.mockResolvedValueOnce({ rows: [] }); // requirePermission's overrides lookup

        const staffRoutes = require('../routes/warehouseRoutes').default;
        const staffApp = express();
        staffApp.use(express.json());
        staffApp.use('/api/warehouses', staffRoutes);

        const res = await request(staffApp).post('/api/warehouses').send({ name: 'Dagonna' });

        expect(res.status).toBe(403);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.resetModules();
    });
});
