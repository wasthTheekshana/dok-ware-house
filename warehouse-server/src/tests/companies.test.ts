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

import companyRoutes from '../routes/companyRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/companies', companyRoutes);

describe('Companies API', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('GET /api/companies returns the list', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, NAME: 'AB Securitas', DEPARTMENT_COUNT: 3, TOTAL_BOX_COUNT: 40 }] });

        const res = await request(app).get('/api/companies');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].NAME).toBe('AB Securitas');
    });

    it('GET /api/companies is unscoped for system_admin (no extra WHERE clause)', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/companies');

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[0][0]).not.toMatch(/WHERE c\.id IN/);
    });

    it('GET /api/companies/:id returns company with departments', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, NAME: 'AB Securitas' }] })
            .mockResolvedValueOnce({ rows: [{ ID: 10, NAME: 'CASH DEPT', CURRENT_BOX_COUNT: 30 }] });

        const res = await request(app).get('/api/companies/1');

        expect(res.status).toBe(200);
        expect(res.body.DEPARTMENTS).toHaveLength(1);
        expect(res.body.DEPARTMENTS[0].NAME).toBe('CASH DEPT');
    });

    it('GET /api/companies/:id returns 404 when missing', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/companies/999');

        expect(res.status).toBe(404);
    });

    it('POST /api/companies rejects a body with no name', async () => {
        const res = await request(app).post('/api/companies').send({ code: 'ABS' });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('POST /api/companies creates a company', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, NAME: 'AB Securitas' }] });

        const res = await request(app).post('/api/companies').send({ name: 'AB Securitas' });

        expect(res.status).toBe(201);
        expect(res.body.NAME).toBe('AB Securitas');
    });

    it('GET /api/companies/:id strips department pricing fields for a non-admin user', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 1, role: 'warehouse_admin' };
                next();
            },
            requireRole: (_roles: string[]) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../middleware/permissionMiddleware', () => ({
            requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../db/dbUtils', () => ({ execute: mockExecute }));

        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, NAME: 'AB Securitas' }] })
            .mockResolvedValueOnce({
                rows: [{ ID: 10, NAME: 'CASH DEPT', CURRENT_BOX_COUNT: 30, PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20, PRICE_PER_BOX_STORED_MONTHLY: 5 }],
            });

        const staffRoutes = require('../routes/companyRoutes').default;
        const staffApp = express();
        staffApp.use(express.json());
        staffApp.use('/api/companies', staffRoutes);

        const res = await request(staffApp).get('/api/companies/1');

        expect(res.status).toBe(200);
        expect(res.body.DEPARTMENTS[0].NAME).toBe('CASH DEPT');
        expect(res.body.DEPARTMENTS[0].PRICE_PER_ARCHIVED_BOX).toBeUndefined();
        expect(res.body.DEPARTMENTS[0].PRICE_PER_RETRIEVED_BOX).toBeUndefined();
        expect(res.body.DEPARTMENTS[0].PRICE_PER_EMPTY_CARTON).toBeUndefined();
        expect(res.body.DEPARTMENTS[0].PRICE_PER_BOX_STORED_MONTHLY).toBeUndefined();

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });

    it('GET /api/companies/:id returns 404 for a warehouse_admin with zero departments in scope', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 1, role: 'warehouse_admin', warehouse_ids: [2] };
                next();
            },
            requireRole: (_roles: string[]) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../middleware/permissionMiddleware', () => ({
            requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../db/dbUtils', () => ({ execute: mockExecute }));

        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, NAME: 'AB Securitas' }] }) // company lookup
            .mockResolvedValueOnce({ rows: [] }); // scoped department lookup — nothing in scope

        const scopedRoutes = require('../routes/companyRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/companies', scopedRoutes);

        const res = await request(scopedApp).get('/api/companies/1');

        expect(res.status).toBe(404);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});

describe('Companies API — admin-only write gating (real requirePermission)', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('POST /api/companies returns 403 for a user without manage_companies', async () => {
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

        const staffRoutes = require('../routes/companyRoutes').default;
        const staffApp = express();
        staffApp.use(express.json());
        staffApp.use('/api/companies', staffRoutes);

        const res = await request(staffApp).post('/api/companies').send({ name: 'AB Securitas' });

        expect(res.status).toBe(403);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.resetModules();
    });
});

describe('GET /api/companies — warehouse scoping for warehouse_admin', () => {
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
        jest.doMock('../db/dbUtils', () => ({ execute: mockExecute }));

        mockExecute.mockResolvedValueOnce({ rows: [] });

        const scopedRoutes = require('../routes/companyRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/companies', scopedRoutes);

        const res = await request(scopedApp).get('/api/companies');

        expect(res.status).toBe(200);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/WHERE c\.id IN \(SELECT company_id FROM departments WHERE warehouse_id = ANY\(:warehouse_ids\)\)/);
        expect(params.warehouse_ids).toEqual([2]);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
