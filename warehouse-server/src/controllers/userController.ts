import { Request, Response } from 'express';
import { execute, withTransaction } from '../db/dbUtils';
import { hashPassword, comparePassword } from '../utils/authUtils';
import { wouldRemoveLastAdmin } from '../utils/adminGuard';
import { AuthRequest } from '../middleware/authMiddleware';

export const getUsers = async (req: Request, res: Response) => {
    try {
        const result = await execute<any>(
            `SELECT id, username, name, role, status, warehouse_ids, created_at FROM users ORDER BY name`
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
            `SELECT id, username, name, role, status, warehouse_ids, created_at FROM users WHERE id = :id`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const user = result.rows[0];
        const overridesResult = await execute<any>(
            `SELECT permission_key, granted FROM user_permission_overrides WHERE user_id = :id`,
            [req.params.id]
        );
        user.PERMISSION_OVERRIDES = overridesResult.rows;
        res.json(user);
    } catch (err) {
        console.error('getUserById error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createUser = async (req: Request, res: Response) => {
    const { username, name, password, role, warehouse_ids } = req.body;
    try {
        const passwordHash = await hashPassword(password);
        const result = await execute<any>(
            `INSERT INTO users (username, password_hash, name, role, warehouse_ids)
             VALUES (:username, :password_hash, :name, :role, :warehouse_ids)
             RETURNING id, username, name, role, status, warehouse_ids, created_at`,
            { username, password_hash: passwordHash, name, role, warehouse_ids: warehouse_ids || [] }
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

const ALLOWED_UPDATE_FIELDS = ['name', 'role', 'status', 'password_hash', 'warehouse_ids'] as const;

export const updateUser = async (req: Request, res: Response) => {
    const { password, permission_overrides, ...fields } = req.body;
    try {
        const result = await withTransaction(async (exec) => {
            const existingResult = await exec<any>(`SELECT id, role, status FROM users WHERE id = :id FOR UPDATE`, [req.params.id]);
            if (existingResult.rows.length === 0) {
                return null;
            }
            const existing = existingResult.rows[0];
            const isCurrentlyActiveAdmin = existing.ROLE === 'system_admin' && existing.STATUS === 'active';

            if (isCurrentlyActiveAdmin) {
                const countResult = await exec<any>(
                    `WITH locked AS (
                        SELECT id FROM users WHERE role = 'system_admin' AND status = 'active' AND id != :id FOR UPDATE
                    )
                    SELECT COUNT(*)::int AS count FROM locked`,
                    [req.params.id]
                );
                const otherActiveAdminCount = countResult.rows[0].COUNT;
                if (wouldRemoveLastAdmin(isCurrentlyActiveAdmin, fields.role, fields.status, otherActiveAdminCount)) {
                    return 'LAST_ADMIN';
                }
            }

            const updateFields: any = { ...fields };
            if (password) {
                updateFields.password_hash = await hashPassword(password);
            }
            const keys = Object.keys(updateFields).filter(k => (ALLOWED_UPDATE_FIELDS as readonly string[]).includes(k));

            let updatedUser: any = null;
            if (keys.length > 0) {
                const setClauses = keys.map(key => `${key} = :${key}`).join(', ');
                const updateResult = await exec<any>(
                    `UPDATE users SET ${setClauses} WHERE id = :id RETURNING id, username, name, role, status, warehouse_ids, created_at`,
                    { ...updateFields, id: req.params.id }
                );
                updatedUser = updateResult.rows[0];
            }

            if (permission_overrides !== undefined) {
                await exec(`DELETE FROM user_permission_overrides WHERE user_id = :user_id`, { user_id: req.params.id });
                for (const override of permission_overrides) {
                    await exec(
                        `INSERT INTO user_permission_overrides (user_id, permission_key, granted) VALUES (:user_id, :permission_key, :granted)`,
                        { user_id: req.params.id, permission_key: override.permission_key, granted: override.granted }
                    );
                }
            }

            if (!updatedUser) {
                const fetchResult = await exec<any>(
                    `SELECT id, username, name, role, status, warehouse_ids, created_at FROM users WHERE id = :id`,
                    [req.params.id]
                );
                updatedUser = fetchResult.rows[0];
            }
            return updatedUser;
        });

        if (result === null) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (result === 'LAST_ADMIN') {
            return res.status(400).json({ message: 'Cannot remove the last active admin' });
        }
        res.json(result);
    } catch (err) {
        console.error('updateUser error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const changeOwnPassword = async (req: AuthRequest, res: Response) => {
    const { current_password, new_password } = req.body;
    const userId = req.user?.id;
    try {
        const result = await execute<any>(`SELECT password_hash FROM users WHERE id = :id AND status = 'active'`, [userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const isMatch = await comparePassword(current_password, result.rows[0].PASSWORD_HASH);
        if (!isMatch) {
            return res.status(403).json({ message: 'Current password is incorrect' });
        }
        const newHash = await hashPassword(new_password);
        await execute(`UPDATE users SET password_hash = :password_hash WHERE id = :id`, { password_hash: newHash, id: userId });
        res.json({ message: 'Password updated' });
    } catch (err) {
        console.error('changeOwnPassword error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
