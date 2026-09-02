import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';
import { hashPassword } from '../utils/authUtils';
import { wouldRemoveLastAdmin } from '../utils/adminGuard';

export const getUsers = async (req: Request, res: Response) => {
    try {
        const result = await execute<any>(
            `SELECT id, username, name, role, status, created_at FROM users ORDER BY name`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('getUsers error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getUserById = async (req: Request, res: Response) => {
    try {
        const result = await execute<any>(
            `SELECT id, username, name, role, status, created_at FROM users WHERE id = :id`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('getUserById error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createUser = async (req: Request, res: Response) => {
    const { username, name, password, role } = req.body;
    try {
        const passwordHash = await hashPassword(password);
        const result = await execute<any>(
            `INSERT INTO users (username, password_hash, name, role)
             VALUES (:username, :password_hash, :name, :role)
             RETURNING id, username, name, role, status, created_at`,
            { username, password_hash: passwordHash, name, role }
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'Username already exists' });
        }
        console.error('createUser error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateUser = async (req: Request, res: Response) => {
    const { password, ...fields } = req.body;
    try {
        const existingResult = await execute<any>(`SELECT id, role, status FROM users WHERE id = :id`, [req.params.id]);
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const existing = existingResult.rows[0];
        const isCurrentlyActiveAdmin = existing.ROLE === 'admin' && existing.STATUS === 'active';

        if (isCurrentlyActiveAdmin) {
            const countResult = await execute<any>(
                `SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active' AND id != :id`,
                [req.params.id]
            );
            const otherActiveAdminCount = countResult.rows[0].COUNT;
            if (wouldRemoveLastAdmin(isCurrentlyActiveAdmin, fields.role, fields.status, otherActiveAdminCount)) {
                return res.status(400).json({ message: 'Cannot remove the last active admin' });
            }
        }

        const updateFields: any = { ...fields };
        if (password) {
            updateFields.password_hash = await hashPassword(password);
        }
        const setClauses = Object.keys(updateFields).map(key => `${key} = :${key}`).join(', ');

        const result = await execute<any>(
            `UPDATE users SET ${setClauses} WHERE id = :id RETURNING id, username, name, role, status, created_at`,
            { ...updateFields, id: req.params.id }
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateUser error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
