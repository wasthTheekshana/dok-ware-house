/// <reference types="jest" />
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../middleware/authMiddleware', () => ({
    authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = { id: 1, role: 'admin' };
        next();
    },
}));

jest.mock('../db/dbUtils', () => ({ execute: jest.fn() }));

import summaryRoutes from '../routes/summaryRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/summary', summaryRoutes);

describe('Summary API', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('GET /api/summary/companies returns company totals', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ COMPANY_ID: 1, COMPANY_NAME: 'AB Securitas', TOTAL_BOX_COUNT: 40 }] });

        const res = await request(app).get('/api/summary/companies');

        expect(res.status).toBe(200);
        expect(res.body[0].TOTAL_BOX_COUNT).toBe(40);
    });

    it('GET /api/summary/monthly applies from/to filters', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/summary/monthly?from=2026-01-01&to=2026-07-31');

        expect(res.status).toBe(200);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND event_date >= :from/);
        expect(query).toMatch(/AND event_date <= :to/);
        expect(params).toMatchObject({ from: '2026-01-01', to: '2026-07-31' });
    });
});
