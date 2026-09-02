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
jest.mock('../utils/authUtils', () => ({
    hashPassword: jest.fn(async (pw: string) => `hashed:${pw}`),
    comparePassword: jest.fn(),
    generateToken: jest.fn(),
    verifyToken: jest.fn(),
}));

import userRoutes from '../routes/userRoutes';
import { execute } from '../db/dbUtils';
import { comparePassword } from '../utils/authUtils';

const mockExecute = execute as jest.Mock;
const mockComparePassword = comparePassword as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/users', userRoutes);

describe('Users API', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('GET /api/users returns the list', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, USERNAME: 'admin', NAME: 'Administrator', ROLE: 'admin', STATUS: 'active' }] });

        const res = await request(app).get('/api/users');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].USERNAME).toBe('admin');
    });

    it('GET /api/users/:id returns a single user', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 2, USERNAME: 'staff1', NAME: 'Staff One', ROLE: 'staff', STATUS: 'active' }] });

        const res = await request(app).get('/api/users/2');

        expect(res.status).toBe(200);
        expect(res.body.USERNAME).toBe('staff1');
    });

    it('GET /api/users/:id returns 404 when missing', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/users/999');

        expect(res.status).toBe(404);
    });

    it('POST /api/users rejects a body with no username', async () => {
        const res = await request(app).post('/api/users').send({ name: 'X', password: 'password123', role: 'staff' });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('POST /api/users creates a user with a hashed password', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 3, USERNAME: 'newstaff', NAME: 'New Staff', ROLE: 'staff', STATUS: 'active' }] });

        const res = await request(app).post('/api/users').send({ username: 'newstaff', name: 'New Staff', password: 'password123', role: 'staff' });

        expect(res.status).toBe(201);
        expect(res.body.USERNAME).toBe('newstaff');
        const insertCall = mockExecute.mock.calls[0];
        expect(insertCall[1].password_hash).toBe('hashed:password123');
    });

    it('POST /api/users returns 409 for a duplicate username', async () => {
        const err: any = new Error('Duplicate key');
        err.code = '23505';
        mockExecute.mockRejectedValueOnce(err);

        const res = await request(app).post('/api/users').send({ username: 'admin', name: 'X', password: 'password123', role: 'staff' });

        expect(res.status).toBe(409);
    });

    it('PUT /api/users/:id updates a non-admin field without triggering the admin-count check', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 2, ROLE: 'staff', STATUS: 'active' }] }) // existing-user lookup
            .mockResolvedValueOnce({ rows: [{ ID: 2, USERNAME: 'staff1', NAME: 'Updated Name', ROLE: 'staff', STATUS: 'active' }] }); // update

        const res = await request(app).put('/api/users/2').send({ name: 'Updated Name' });

        expect(res.status).toBe(200);
        expect(res.body.NAME).toBe('Updated Name');
        expect(mockExecute).toHaveBeenCalledTimes(2); // no admin-count query — target wasn't an active admin
    });

    it('PUT /api/users/:id rejects demoting the sole active admin', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, ROLE: 'admin', STATUS: 'active' }] }) // existing-user lookup
            .mockResolvedValueOnce({ rows: [{ COUNT: 0 }] }); // other-active-admins count

        const res = await request(app).put('/api/users/1').send({ role: 'staff' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/last active admin/);
        expect(mockExecute).toHaveBeenCalledTimes(2); // no UPDATE ran
    });

    it('PUT /api/users/:id allows demoting an admin when another active admin exists', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, ROLE: 'admin', STATUS: 'active' }] }) // existing-user lookup
            .mockResolvedValueOnce({ rows: [{ COUNT: 1 }] }) // other-active-admins count
            .mockResolvedValueOnce({ rows: [{ ID: 1, USERNAME: 'admin', NAME: 'Administrator', ROLE: 'staff', STATUS: 'active' }] }); // update

        const res = await request(app).put('/api/users/1').send({ role: 'staff' });

        expect(res.status).toBe(200);
        expect(res.body.ROLE).toBe('staff');
    });

    it('PUT /api/users/:id returns 404 when the target user does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).put('/api/users/999').send({ name: 'X' });

        expect(res.status).toBe(404);
    });
});

describe('Users API — admin-only gating (real requireRole)', () => {
    const { requireRole: realRequireRole } = jest.requireActual('../middleware/authMiddleware');

    beforeEach(() => { mockExecute.mockReset(); });

    it('GET /api/users returns 403 for a non-admin user', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 1, role: 'staff' };
                next();
            },
            requireRole: realRequireRole,
        }));
        jest.doMock('../db/dbUtils', () => ({ execute: mockExecute }));

        const staffRoutes = require('../routes/userRoutes').default;
        const staffApp = express();
        staffApp.use(express.json());
        staffApp.use('/api/users', staffRoutes);

        const res = await request(staffApp).get('/api/users');

        expect(res.status).toBe(403);
        expect(mockExecute).not.toHaveBeenCalled();

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});

describe('POST /api/users/me/change-password', () => {
    beforeEach(() => {
        mockExecute.mockReset();
        mockComparePassword.mockReset();
    });

    it('rejects an incorrect current password', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ PASSWORD_HASH: 'hashed:oldpass' }] });
        mockComparePassword.mockResolvedValueOnce(false);

        const res = await request(app).post('/api/users/me/change-password').send({ current_password: 'wrong', new_password: 'newpass123' });

        expect(res.status).toBe(401);
        expect(mockExecute).toHaveBeenCalledTimes(1); // no UPDATE ran
    });

    it('updates the password when the current password is correct', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ PASSWORD_HASH: 'hashed:oldpass' }] })
            .mockResolvedValueOnce({ rows: [] }); // UPDATE
        mockComparePassword.mockResolvedValueOnce(true);

        const res = await request(app).post('/api/users/me/change-password').send({ current_password: 'oldpass', new_password: 'newpass123' });

        expect(res.status).toBe(200);
        const updateCall = mockExecute.mock.calls[1];
        expect(updateCall[0]).toMatch(/UPDATE users SET password_hash/);
        expect(updateCall[1].password_hash).toBe('hashed:newpass123');
    });

    it('rejects a body with no new_password', async () => {
        const res = await request(app).post('/api/users/me/change-password').send({ current_password: 'oldpass' });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});
