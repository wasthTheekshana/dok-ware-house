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
});
