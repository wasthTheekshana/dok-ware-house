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

import staffRoutes from '../routes/staffRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/staff', staffRoutes);

const VALID_BODY = { warehouse_id: 1, name: 'Kamal Perera', nic: '901234567V', join_date: '2020-01-15' };

describe('POST /api/staff', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('creates a staff member, defaulting basic_salary to 0', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, WAREHOUSE_ID: 1, NAME: 'Kamal Perera', NIC: '901234567V', BASIC_SALARY: 0 }] });

        const res = await request(app).post('/api/staff').send(VALID_BODY);

        expect(res.status).toBe(201);
        const [, params] = mockExecute.mock.calls[0];
        expect(params).toMatchObject({ warehouse_id: 1, name: 'Kamal Perera', nic: '901234567V', basic_salary: 0 });
    });

    it('rejects a body missing required fields', async () => {
        const res = await request(app).post('/api/staff').send({ warehouse_id: 1, name: 'Kamal' });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('GET /api/staff', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('filters by warehouse_id and status', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/staff?warehouse_id=1&status=active');

        expect(res.status).toBe(200);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND s\.warehouse_id = :warehouse_id/);
        expect(query).toMatch(/AND s\.status = :status/);
        expect(params).toMatchObject({ warehouse_id: '1', status: 'active' });
    });
});

describe('PUT /api/staff/:id', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('deactivates a staff member', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] })
            .mockResolvedValueOnce({ rows: [{ ID: 1, STATUS: 'inactive' }] });

        const res = await request(app).put('/api/staff/1').send({ status: 'inactive' });

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[1][0]).toMatch(/UPDATE staff SET status = :status/);
    });

    it('returns 404 when the staff member does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).put('/api/staff/999').send({ status: 'inactive' });

        expect(res.status).toBe(404);
    });
});

describe('POST /api/staff — warehouse scoping for warehouse_admin', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('rejects creating a staff member for a warehouse outside the warehouse_admin\'s warehouse_ids', async () => {
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

        const scopedRoutes = require('../routes/staffRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/staff', scopedRoutes);

        const res = await request(scopedApp).post('/api/staff').send({ ...VALID_BODY, warehouse_id: 1 });

        expect(res.status).toBe(400);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});

describe('GET /api/staff — warehouse scoping for warehouse_admin', () => {
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

        const scopedRoutes = require('../routes/staffRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/staff', scopedRoutes);

        const res = await request(scopedApp).get('/api/staff');

        expect(res.status).toBe(200);
        const { execute: scopedExecute } = require('../db/dbUtils');
        const [query, params] = scopedExecute.mock.calls[0];
        expect(query).toMatch(/AND s\.warehouse_id = ANY\(:warehouse_ids\)/);
        expect(params.warehouse_ids).toEqual([2]);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
