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

describe('Departments API', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('POST rejects when company_id does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] }); // company check

        const res = await request(app).post('/api/departments').send({ company_id: 999, name: 'CASH DEPT' });

        expect(res.status).toBe(400);
    });

    it('POST creates a department when company exists', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // company check
            .mockResolvedValueOnce({ rows: [{ ID: 10, COMPANY_ID: 1, NAME: 'CASH DEPT', CURRENT_BOX_COUNT: 0 }] }); // insert

        const res = await request(app).post('/api/departments').send({ company_id: 1, name: 'CASH DEPT' });

        expect(res.status).toBe(201);
        expect(res.body.NAME).toBe('CASH DEPT');
    });

    it('GET filters by company_id', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 10, NAME: 'CASH DEPT' }] });

        const res = await request(app).get('/api/departments?company_id=1');

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[0][0]).toMatch(/AND company_id = :company_id/);
    });

    it('POST returns 409 when duplicate name within company', async () => {
        const err: any = new Error('Duplicate key');
        err.code = '23505';
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // company exists
            .mockRejectedValueOnce(err); // duplicate key on insert

        const res = await request(app).post('/api/departments').send({ company_id: 1, name: 'CASH DEPT' });

        expect(res.status).toBe(409);
    });
});
