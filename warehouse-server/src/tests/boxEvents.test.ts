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

jest.mock('../db/dbUtils', () => {
    const execute = jest.fn();
    return {
        execute,
        withTransaction: jest.fn(async (fn: any) => fn(execute)),
    };
});

import boxEventRoutes from '../routes/boxEventRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/box-events', boxEventRoutes);

const VALID_BODY = { department_id: 1, event_type: 'archived', quantity: 10, event_date: '2026-07-15' };

describe('POST /api/box-events', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('creates an archived event and increments the department count', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, CURRENT_BOX_COUNT: 100 }] }) // SELECT ... FOR UPDATE
            .mockResolvedValueOnce({ rows: [] })                                  // UPDATE departments
            .mockResolvedValueOnce({ rows: [{ ID: 1, DEPARTMENT_ID: 1, EVENT_TYPE: 'archived', QUANTITY: 10 }] }); // INSERT

        const res = await request(app).post('/api/box-events').send(VALID_BODY);

        expect(res.status).toBe(201);
        const updateCall = mockExecute.mock.calls[1];
        expect(updateCall[0]).toMatch(/UPDATE departments SET current_box_count/);
        expect(updateCall[1]).toMatchObject({ new_count: 110 });
    });

    it('rejects a retrieved event that would go negative', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, CURRENT_BOX_COUNT: 5 }] }); // SELECT ... FOR UPDATE

        const res = await request(app).post('/api/box-events').send({ ...VALID_BODY, event_type: 'retrieved', quantity: 6 });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Insufficient boxes/);
        // Only the SELECT should have run — no UPDATE or INSERT
        expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('returns 404 when the department does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).post('/api/box-events').send(VALID_BODY);

        expect(res.status).toBe(404);
    });

    it('rejects an invalid event_type', async () => {
        const res = await request(app).post('/api/box-events').send({ ...VALID_BODY, event_type: 'received' });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('GET /api/box-events', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('filters by department_id and event_type', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/box-events?department_id=1&event_type=archived');

        expect(res.status).toBe(200);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND be.department_id = :department_id/);
        expect(query).toMatch(/AND be.event_type = :event_type/);
        expect(params).toMatchObject({ department_id: '1', event_type: 'archived' });
    });
});

describe('PUT /api/box-events/:id', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('recomputes the department count from the delta between old and new event values', async () => {
        // department currently at 30 (was: +50 archived, -20 retrieved); editing the
        // archived event's quantity up to 60 should raise the count to 40
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 5, DEPARTMENT_ID: 1, EVENT_TYPE: 'archived', QUANTITY: 50, CURRENT_BOX_COUNT: 30 }] }) // SELECT ... FOR UPDATE
            .mockResolvedValueOnce({ rows: [] }) // UPDATE departments
            .mockResolvedValueOnce({ rows: [{ ID: 5, DEPARTMENT_ID: 1, EVENT_TYPE: 'archived', QUANTITY: 60 }] }); // UPDATE box_events

        const res = await request(app).put('/api/box-events/5').send({ quantity: 60 });

        expect(res.status).toBe(200);
        const deptUpdateCall = mockExecute.mock.calls[1];
        expect(deptUpdateCall[0]).toMatch(/UPDATE departments SET current_box_count/);
        expect(deptUpdateCall[1]).toMatchObject({ new_count: 40 });
    });

    it('rejects an edit that would take the department count negative', async () => {
        // same department at 30 (was: +50 archived, -20 retrieved); editing the
        // archived event's quantity down to 10 would drop the count to -10
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 5, DEPARTMENT_ID: 1, EVENT_TYPE: 'archived', QUANTITY: 50, CURRENT_BOX_COUNT: 30 }] });

        const res = await request(app).put('/api/box-events/5').send({ quantity: 10 });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Insufficient boxes/);
        // Only the SELECT should have run — no UPDATE
        expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('returns 404 when the event does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).put('/api/box-events/999').send({ quantity: 10 });

        expect(res.status).toBe(404);
    });

    it('rejects a body with no fields to update', async () => {
        const res = await request(app).put('/api/box-events/5').send({});

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('DELETE /api/box-events/:id', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('reverses the event effect and deletes the row', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 5, DEPARTMENT_ID: 1, EVENT_TYPE: 'archived', QUANTITY: 10, CURRENT_BOX_COUNT: 110 }] }) // SELECT ... FOR UPDATE
            .mockResolvedValueOnce({ rows: [] }) // UPDATE departments
            .mockResolvedValueOnce({ rows: [] }); // DELETE box_events

        const res = await request(app).delete('/api/box-events/5');

        expect(res.status).toBe(200);
        const deptUpdateCall = mockExecute.mock.calls[1];
        expect(deptUpdateCall[0]).toMatch(/UPDATE departments SET current_box_count/);
        expect(deptUpdateCall[1]).toMatchObject({ new_count: 100 });
        const deleteCall = mockExecute.mock.calls[2];
        expect(deleteCall[0]).toMatch(/DELETE FROM box_events/);
    });

    it('rejects a delete that would take the department count negative', async () => {
        // department at 30 (was: +50 archived, -20 retrieved); deleting the
        // archived-50 event would drop the count to -20
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 5, DEPARTMENT_ID: 1, EVENT_TYPE: 'archived', QUANTITY: 50, CURRENT_BOX_COUNT: 30 }] });

        const res = await request(app).delete('/api/box-events/5');

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Insufficient boxes/);
        expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('returns 404 when the event does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).delete('/api/box-events/999');

        expect(res.status).toBe(404);
    });
});
