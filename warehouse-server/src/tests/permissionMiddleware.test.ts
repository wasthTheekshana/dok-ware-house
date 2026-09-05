/// <reference types="jest" />
import { Response } from 'express';

jest.mock('../db/dbUtils', () => ({ execute: jest.fn() }));

import { requirePermission } from '../middleware/permissionMiddleware';
import { execute } from '../db/dbUtils';
import { AuthRequest } from '../middleware/authMiddleware';

const mockExecute = execute as jest.Mock;

function mockRes() {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
}

describe('requirePermission', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('calls next() when the role default grants the permission and there are no overrides', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });
        const req = { user: { id: 1, role: 'system_admin' } } as AuthRequest;
        const res = mockRes();
        const next = jest.fn();

        await requirePermission('manage_users')(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 when the role default does not grant the permission and there are no overrides', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });
        const req = { user: { id: 2, role: 'warehouse_admin' } } as AuthRequest;
        const res = mockRes();
        const next = jest.fn();

        await requirePermission('manage_users')(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('calls next() when an override grants a permission the role default lacks', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ PERMISSION_KEY: 'view_invoices', GRANTED: true }] });
        const req = { user: { id: 3, role: 'warehouse_admin' } } as AuthRequest;
        const res = mockRes();
        const next = jest.fn();

        await requirePermission('view_invoices')(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    it('returns 403 when an override revokes a permission the role default grants', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ PERMISSION_KEY: 'manage_box_events', GRANTED: false }] });
        const req = { user: { id: 4, role: 'warehouse_admin' } } as AuthRequest;
        const res = mockRes();
        const next = jest.fn();

        await requirePermission('manage_box_events')(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 403 when req.user is missing', async () => {
        const req = {} as AuthRequest;
        const res = mockRes();
        const next = jest.fn();

        await requirePermission('manage_users')(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});
