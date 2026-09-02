import dotenv from 'dotenv';
dotenv.config();

import { initializeDb, closeDb, getPool } from '../db/config';
import { hashPassword } from '../utils/authUtils';

async function seed() {
    await initializeDb();
    const pool = getPool();

    const existing = await pool.query(`SELECT id FROM users WHERE username = 'admin'`);
    if (existing.rows.length === 0) {
        const passwordHash = await hashPassword('password123');
        await pool.query(
            `INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, $3, $4)`,
            ['admin', passwordHash, 'Administrator', 'admin']
        );
        console.log('Seeded admin user: admin / password123');
    } else {
        console.log('Admin user already exists, skipping.');
    }

    await closeDb();
}

seed().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
});
