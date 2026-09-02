/// <reference types="jest" />
import request from 'supertest';
import express from 'express';
import bcrypt from 'bcrypt';

jest.mock('../db/dbUtils', () => ({
    execute: jest.fn(),
}));

import authRoutes from '../routes/authRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('POST /api/auth/login', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('returns a token for valid credentials', async () => {
        const passwordHash = await bcrypt.hash('password123', 10);
        mockExecute.mockResolvedValueOnce({
            rows: [{ ID: 1, USERNAME: 'admin', NAME: 'Administrator', ROLE: 'admin', STATUS: 'active', PASSWORD_HASH: passwordHash }],
        });

        const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'password123' });

        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();
        expect(res.body.user.USERNAME).toBe('admin');
        expect(res.body.user.PASSWORD_HASH).toBeUndefined();
    });

    it('rejects wrong password', async () => {
        const passwordHash = await bcrypt.hash('password123', 10);
        mockExecute.mockResolvedValueOnce({
            rows: [{ ID: 1, USERNAME: 'admin', ROLE: 'admin', STATUS: 'active', PASSWORD_HASH: passwordHash }],
        });

        const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });

        expect(res.status).toBe(401);
    });

    it('rejects unknown user', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'x' });

        expect(res.status).toBe(401);
    });
});
