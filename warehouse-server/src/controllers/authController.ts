import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';
import { comparePassword, generateToken } from '../utils/authUtils';

export const login = async (req: Request, res: Response) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'username and password are required' });
    }

    try {
        const result = await execute<any>(
            `SELECT * FROM users WHERE username = :username`,
            [username]
        );

        if (!result.rows || result.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const isMatch = await comparePassword(password, user.PASSWORD_HASH);

        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        if (user.STATUS !== 'active') {
            return res.status(403).json({ message: 'Account is inactive' });
        }

        const token = generateToken({ id: user.ID, username: user.USERNAME, role: user.ROLE });

        const { PASSWORD_HASH, ...userWithoutPassword } = user;

        res.json({ token, user: userWithoutPassword });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
