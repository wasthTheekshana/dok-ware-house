/// <reference types="jest" />
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../middleware/authMiddleware', () => ({
    authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = { id: 1, role: 'admin' };
        next();
    },
    requireRole: (_roles: string[]) => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../db/dbUtils', () => ({ execute: jest.fn() }));

import departmentRoutes from '../routes/departmentRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/departments', departmentRoutes);

const VALID_BODY = { company_id: 1, warehouse_id: 1, name: 'CASH DEPT' };

describe('Departments API', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('POST rejects when company_id does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] }); // company check

        const res = await request(app).post('/api/departments').send(VALID_BODY);

        expect(res.status).toBe(400);
        expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('POST rejects when warehouse_id is missing', async () => {
        const res = await request(app).post('/api/departments').send({ company_id: 1, name: 'CASH DEPT' });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('POST rejects when warehouse_id does not exist', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // company check passes
            .mockResolvedValueOnce({ rows: [] }); // warehouse check fails

        const res = await request(app).post('/api/departments').send(VALID_BODY);

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/warehouse_id/);
        expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it('POST creates a department when company and warehouse both exist', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // company check
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // warehouse check
            .mockResolvedValueOnce({ rows: [{ ID: 10, COMPANY_ID: 1, WAREHOUSE_ID: 1, NAME: 'CASH DEPT', CURRENT_BOX_COUNT: 0 }] }); // insert

        const res = await request(app).post('/api/departments').send(VALID_BODY);

        expect(res.status).toBe(201);
        expect(res.body.NAME).toBe('CASH DEPT');
    });

    it('GET filters by company_id', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 10, NAME: 'CASH DEPT' }] });

        const res = await request(app).get('/api/departments?company_id=1');

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[0][0]).toMatch(/AND d\.company_id = :company_id/);
    });

    it('POST returns 409 when duplicate name within company', async () => {
        const err: any = new Error('Duplicate key');
        err.code = '23505';
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // company exists
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // warehouse exists
            .mockRejectedValueOnce(err); // duplicate key on insert

        const res = await request(app).post('/api/departments').send(VALID_BODY);

        expect(res.status).toBe(409);
    });

    it('PUT /api/departments/:id accepts pricing fields', async () => {
        mockExecute.mockResolvedValueOnce({
            rows: [{ ID: 1, PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20 }],
        });

        const res = await request(app).put('/api/departments/1').send({
            price_per_archived_box: 50,
            price_per_retrieved_box: 45,
            price_per_empty_carton: 20,
        });

        expect(res.status).toBe(200);
        expect(res.body.PRICE_PER_ARCHIVED_BOX).toBe(50);
    });

    it('GET strips pricing fields for a non-admin user', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 1, role: 'staff' };
                next();
            },
            requireRole: (_roles: string[]) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../db/dbUtils', () => ({ execute: mockExecute }));

        mockExecute.mockResolvedValueOnce({
            rows: [{ ID: 10, NAME: 'CASH DEPT', PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20 }],
        });

        const staffRoutes = require('../routes/departmentRoutes').default;
        const staffApp = express();
        staffApp.use(express.json());
        staffApp.use('/api/departments', staffRoutes);

        const res = await request(staffApp).get('/api/departments');

        expect(res.status).toBe(200);
        expect(res.body[0].NAME).toBe('CASH DEPT');
        expect(res.body[0].PRICE_PER_ARCHIVED_BOX).toBeUndefined();
        expect(res.body[0].PRICE_PER_RETRIEVED_BOX).toBeUndefined();
        expect(res.body[0].PRICE_PER_EMPTY_CARTON).toBeUndefined();

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
