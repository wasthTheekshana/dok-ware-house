# Warehouse Customers & Box Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new, standalone warehouse app (`warehouse-server` + `warehouse-client`) that tracks DOK's customers/departments and the box lifecycle (archived / retrieved / empty-carton-issued), replacing the manual Excel workbooks for this data.

**Architecture:** Node + Express + TypeScript REST API backed by PostgreSQL, using the same `execute`/`withTransaction` named-parameter query helper pattern as the existing `server/` app (for consistency, not code sharing — this is a separate app with its own DB). React + TypeScript + TailwindCSS SPA frontend, same conventions as the existing `client/` app (axios + interceptors, AuthContext + localStorage token, React Router, Lucide icons, Recharts).

**Tech Stack:** Express 5, TypeScript, `pg` (PostgreSQL driver), bcrypt, jsonwebtoken, zod, Jest + ts-jest + supertest (backend). React 19, Vite, TailwindCSS v4, react-router-dom, axios, recharts, lucide-react (frontend).

**Spec:** [docs/superpowers/specs/2026-08-24-warehouse-customer-box-inventory-design.md](../specs/2026-08-24-warehouse-customer-box-inventory-design.md)

## Global Constraints

- Backend lives at `warehouse-server/`, frontend at `warehouse-client/`, both siblings of the existing `server/`/`client/` — do not modify anything under `server/` or `client/`.
- Backend port: `5100` (existing DOK-HR server uses `5000` — must not collide). Frontend dev port: `5175`.
- Database: PostgreSQL, database name `dok_warehouse`, via the `pg` npm package — never `oracledb`.
- All SQL queries go through the shared `execute()` / `withTransaction()` helper in `warehouse-server/src/db/dbUtils.ts` using named `:param` placeholders — never inline string-interpolated SQL, never raw `pool.query()` outside that helper.
- Row objects returned from `execute()` have UPPERCASE keys (matches the existing app's Oracle-compat convention) — controllers and frontend types must use `ROW.FIELD_NAME`, not `row.fieldName`.
- Every API route except `POST /api/auth/login` requires a valid JWT via `authenticateToken` middleware.
- Event types are exactly three strings: `archived`, `retrieved`, `empty_carton_issued` — no `received` event type (see spec's "Decisions" section).
- `departments.current_box_count` must never go negative — a `retrieved` event whose quantity exceeds the current count must be rejected with HTTP 400, not clamped or silently allowed.

---

## Task 1: Backend scaffolding — project setup, DB connection, health check

**Files:**
- Create: `warehouse-server/package.json`
- Create: `warehouse-server/tsconfig.json`
- Create: `warehouse-server/.env.example`
- Create: `warehouse-server/jest.config.js`
- Create: `warehouse-server/src/db/config.ts`
- Create: `warehouse-server/src/db/dbUtils.ts`
- Create: `warehouse-server/src/app.ts`
- Create: `warehouse-server/src/server.ts`
- Test: `warehouse-server/src/tests/health.test.ts`

**Interfaces:**
- Produces: `initializeDb(): Promise<void>`, `closeDb(): Promise<void>`, `getPool(): Pool` from `db/config.ts`
- Produces: `execute<T>(sql: string, params?: Record<string,any>|any[]): Promise<{rows: T[]}>` and `withTransaction<R>(fn: (exec: TxExecutor) => Promise<R>): Promise<R>` from `db/dbUtils.ts`
- Produces: `app` (Express instance) from `app.ts`

- [ ] **Step 1: Create `warehouse-server/package.json`**

```json
{
  "name": "warehouse-server",
  "version": "1.0.0",
  "description": "DOK Warehouse — Customers & Box Inventory API",
  "main": "src/server.ts",
  "scripts": {
    "test": "jest",
    "start": "ts-node src/server.ts",
    "seed": "ts-node src/scripts/seed.ts",
    "dev": "nodemon src/server.ts"
  },
  "license": "ISC",
  "type": "commonjs",
  "dependencies": {
    "@types/pg": "^8.20.0",
    "bcrypt": "^6.0.0",
    "cors": "^2.8.6",
    "dotenv": "^17.2.3",
    "express": "^5.2.1",
    "jsonwebtoken": "^9.0.3",
    "pg": "^8.20.0",
    "zod": "^4.4.1"
  },
  "devDependencies": {
    "@jest/globals": "^30.2.0",
    "@types/bcrypt": "^6.0.0",
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.6",
    "@types/jest": "^30.0.0",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/node": "^25.2.0",
    "@types/supertest": "^6.0.3",
    "jest": "^30.2.0",
    "nodemon": "^3.1.11",
    "supertest": "^7.2.2",
    "ts-jest": "^29.4.6",
    "ts-node": "^10.9.2",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: Create `warehouse-server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `warehouse-server/.env.example`**

```env
PORT=5100
WH_DB_HOST=localhost
WH_DB_PORT=5432
WH_DB_NAME=dok_warehouse
WH_DB_USER=dokwarehouse
WH_DB_PASSWORD=changeme
JWT_SECRET=replace-with-a-long-random-string
```

- [ ] **Step 4: Create `warehouse-server/jest.config.js`**

```js
const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
};
```

- [ ] **Step 5: Create `warehouse-server/src/db/config.ts`**

```typescript
import { Pool, types } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// pg returns bigint (20) and numeric/decimal (1700) as strings by default.
// Parse them as JS numbers so aggregations (COUNT, SUM) work correctly.
types.setTypeParser(20, val => parseInt(val, 10));
types.setTypeParser(1700, val => parseFloat(val));

let pool: Pool;

export async function initializeDb() {
    pool = new Pool({
        host: process.env.WH_DB_HOST || 'localhost',
        port: Number(process.env.WH_DB_PORT || 5432),
        database: process.env.WH_DB_NAME || 'dok_warehouse',
        user: process.env.WH_DB_USER || 'dokwarehouse',
        password: process.env.WH_DB_PASSWORD || '',
        max: 10,
        idleTimeoutMillis: 30000,
    });

    try {
        const client = await pool.connect();

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                username      VARCHAR(64) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                name          VARCHAR(200) NOT NULL,
                role          VARCHAR(20) NOT NULL CHECK (role IN ('admin','staff')),
                status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
                created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS companies (
                id              INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                name            VARCHAR(200) NOT NULL,
                code            VARCHAR(32) UNIQUE,
                contact_person  VARCHAR(200),
                phone           VARCHAR(64),
                email           VARCHAR(200),
                address         TEXT,
                status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
                created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS departments (
                id                 INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                name               VARCHAR(200) NOT NULL,
                code               VARCHAR(32),
                status             VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
                current_box_count  INTEGER NOT NULL DEFAULT 0,
                created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (company_id, name)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS box_events (
                id             INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                department_id  INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
                event_type     VARCHAR(30) NOT NULL CHECK (event_type IN ('archived','retrieved','empty_carton_issued')),
                quantity       INTEGER NOT NULL CHECK (quantity > 0),
                event_date     DATE NOT NULL,
                reference_no   VARCHAR(64),
                remarks        TEXT,
                created_by     INTEGER REFERENCES users(id),
                created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_box_events_department ON box_events(department_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_box_events_date ON box_events(event_date)
        `);

        client.release();
        console.log('Warehouse DB pool created');
    } catch (err) {
        console.error('Error creating warehouse DB pool', err);
        process.exit(1);
    }
}

export async function closeDb() {
    if (pool) {
        await pool.end();
        console.log('Warehouse DB pool closed');
    }
}

export function getPool(): Pool {
    return pool;
}
```

- [ ] **Step 6: Create `warehouse-server/src/db/dbUtils.ts`**

```typescript
import { getPool } from './config';

// Regex matches either a single-quoted SQL string literal (group 1) or a :name param (group 2).
const PARAM_RE = /('(?:[^']|'')*')|(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g;

function convertParams(sql: string, params: Record<string, any> | any[]): { text: string; values: any[] } {
    if (Array.isArray(params)) {
        let idx = 0;
        const text = sql.replace(PARAM_RE, (match, literal) => literal ? match : `$${++idx}`);
        return { text, values: params };
    }

    const values: any[] = [];
    const seen: Record<string, number> = {};
    const text = sql.replace(PARAM_RE, (match, literal, name) => {
        if (literal) return match;
        if (!(name in seen)) {
            seen[name] = values.length + 1;
            values.push(params[name] ?? null);
        }
        return `$${seen[name]}`;
    });
    return { text, values };
}

function uppercaseRows<T>(rows: any[]): T[] {
    return rows.map(row => {
        const upper: Record<string, any> = {};
        for (const key of Object.keys(row)) {
            upper[key.toUpperCase()] = row[key];
        }
        return upper as T;
    });
}

export async function execute<T = any>(
    sql: string,
    params: Record<string, any> | any[] = []
): Promise<{ rows: T[] }> {
    const pool = getPool();
    const client = await pool.connect();
    try {
        const { text, values } = convertParams(sql, params);
        const result = await client.query(text, values.length > 0 ? values : undefined);
        return { rows: uppercaseRows<T>(result.rows) };
    } catch (err) {
        console.error('Database execute error:', err);
        throw err;
    } finally {
        client.release();
    }
}

export type TxExecutor = <T = any>(sql: string, params?: Record<string, any> | any[]) => Promise<{ rows: T[] }>;

export async function withTransaction<R>(fn: (exec: TxExecutor) => Promise<R>): Promise<R> {
    const pool = getPool();
    const client = await pool.connect();
    const exec: TxExecutor = async <T = any>(sql: string, params: Record<string, any> | any[] = []) => {
        const { text, values } = convertParams(sql, params);
        const result = await client.query(text, values.length > 0 ? values : undefined);
        return { rows: uppercaseRows<T>(result.rows) };
    };
    try {
        await client.query('BEGIN');
        const out = await fn(exec);
        await client.query('COMMIT');
        return out;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
        console.error('Database transaction error:', err);
        throw err;
    } finally {
        client.release();
    }
}
```

- [ ] **Step 7: Create `warehouse-server/src/app.ts`**

```typescript
import express from 'express';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

app.use((req, res) => {
    res.status(404).json({ message: 'Route not found', path: req.url });
});

export { app };
```

- [ ] **Step 8: Create `warehouse-server/src/server.ts`**

```typescript
import { app } from './app';
import { initializeDb } from './db/config';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 5100;

async function startServer() {
    await initializeDb();

    app.listen(PORT, () => {
        console.log(`Warehouse server running on port ${PORT}`);
    });
}

startServer();
```

- [ ] **Step 9: Write the failing test — `warehouse-server/src/tests/health.test.ts`**

```typescript
/// <reference types="jest" />
import request from 'supertest';
import { app } from '../app';

describe('GET /health', () => {
    it('returns status ok', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });
});
```

- [ ] **Step 10: Install dependencies and run the test**

Run:
```bash
cd warehouse-server
npm install
npm test
```
Expected: PASS (this test doesn't need a real DB connection — `app.ts` builds routes without touching the pool).

- [ ] **Step 11: Commit**

```bash
git add warehouse-server/package.json warehouse-server/package-lock.json warehouse-server/tsconfig.json warehouse-server/.env.example warehouse-server/jest.config.js warehouse-server/src/db/config.ts warehouse-server/src/db/dbUtils.ts warehouse-server/src/app.ts warehouse-server/src/server.ts warehouse-server/src/tests/health.test.ts
git commit -m "feat(warehouse-server): scaffold Express+Postgres backend with health check"
```

---

## Task 2: Auth — login, JWT middleware, admin seed script

**Files:**
- Create: `warehouse-server/src/utils/authUtils.ts`
- Create: `warehouse-server/src/middleware/authMiddleware.ts`
- Create: `warehouse-server/src/controllers/authController.ts`
- Create: `warehouse-server/src/routes/authRoutes.ts`
- Create: `warehouse-server/src/scripts/seed.ts`
- Modify: `warehouse-server/src/app.ts` (mount `/api/auth`)
- Test: `warehouse-server/src/tests/auth.test.ts`

**Interfaces:**
- Consumes: `execute` from `db/dbUtils.ts` (Task 1)
- Produces: `hashPassword`, `comparePassword`, `generateToken`, `verifyToken` from `utils/authUtils.ts`
- Produces: `authenticateToken`, `requireRole(roles: string[])` middleware from `middleware/authMiddleware.ts` — later tasks import these on every protected route
- Produces: `POST /api/auth/login` → `{ token: string, user: { ID, USERNAME, NAME, ROLE, STATUS } }`

- [ ] **Step 1: Create `warehouse-server/src/utils/authUtils.ts`**

```typescript
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required. Set it in warehouse-server/.env before starting.');
}

export const hashPassword = async (password: string): Promise<string> => {
    return await bcrypt.hash(password, SALT_ROUNDS);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
    return await bcrypt.compare(password, hash);
};

export const generateToken = (payload: object): string => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });
};

export const verifyToken = (token: string): any => {
    return jwt.verify(token, JWT_SECRET);
};
```

- [ ] **Step 2: Create `warehouse-server/src/middleware/authMiddleware.ts`**

```typescript
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/authUtils';

export interface AuthRequest extends Request {
    user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    try {
        req.user = verifyToken(token);
        next();
    } catch (err) {
        return res.sendStatus(401);
    }
};

export const requireRole = (roles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Forbidden: Insufficient privileges' });
        }
        next();
    };
};
```

- [ ] **Step 3: Create `warehouse-server/src/controllers/authController.ts`**

```typescript
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
```

- [ ] **Step 4: Create `warehouse-server/src/routes/authRoutes.ts`**

```typescript
import { Router } from 'express';
import { login } from '../controllers/authController';

const router = Router();

router.post('/login', login);

export default router;
```

- [ ] **Step 5: Modify `warehouse-server/src/app.ts` to mount auth routes**

Add near the top with the other imports:
```typescript
import authRoutes from './routes/authRoutes';
```

Add before the `/health` route:
```typescript
app.use('/api/auth', authRoutes);
```

- [ ] **Step 6: Create `warehouse-server/src/scripts/seed.ts`**

```typescript
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
```

- [ ] **Step 7: Write the failing test — `warehouse-server/src/tests/auth.test.ts`**

```typescript
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
```

- [ ] **Step 8: Set `JWT_SECRET` for the test run and run the tests**

Run:
```bash
cd warehouse-server
JWT_SECRET=test-secret npm test
```
Expected: PASS for all 3 cases (`health.test.ts` and `auth.test.ts`).

- [ ] **Step 9: Commit**

```bash
git add warehouse-server/src/utils/authUtils.ts warehouse-server/src/middleware/authMiddleware.ts warehouse-server/src/controllers/authController.ts warehouse-server/src/routes/authRoutes.ts warehouse-server/src/scripts/seed.ts warehouse-server/src/app.ts warehouse-server/src/tests/auth.test.ts
git commit -m "feat(warehouse-server): add JWT auth, login endpoint, admin seed script"
```

---

## Task 3: Box count transition logic (pure function, TDD)

**Files:**
- Create: `warehouse-server/src/utils/boxCount.ts`
- Test: `warehouse-server/src/tests/boxCount.test.ts`

**Interfaces:**
- Produces: `applyBoxEvent(currentCount: number, eventType: 'archived'|'retrieved'|'empty_carton_issued', quantity: number): number` — throws `Error('Insufficient boxes...')` if a `retrieved` event would take the count negative. Used by Task 6's box-event controller.

- [ ] **Step 1: Write the failing test — `warehouse-server/src/tests/boxCount.test.ts`**

```typescript
/// <reference types="jest" />
import { applyBoxEvent } from '../utils/boxCount';

describe('applyBoxEvent', () => {
    it('increases the count for an archived event', () => {
        expect(applyBoxEvent(100, 'archived', 25)).toBe(125);
    });

    it('decreases the count for a retrieved event', () => {
        expect(applyBoxEvent(100, 'retrieved', 30)).toBe(70);
    });

    it('leaves the count unchanged for an empty_carton_issued event', () => {
        expect(applyBoxEvent(100, 'empty_carton_issued', 10)).toBe(100);
    });

    it('allows a retrieved event that exactly empties the count', () => {
        expect(applyBoxEvent(50, 'retrieved', 50)).toBe(0);
    });

    it('throws when a retrieved event would take the count negative', () => {
        expect(() => applyBoxEvent(10, 'retrieved', 11)).toThrow('Insufficient boxes');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd warehouse-server && npx jest boxCount -v`
Expected: FAIL with "Cannot find module '../utils/boxCount'"

- [ ] **Step 3: Create `warehouse-server/src/utils/boxCount.ts`**

```typescript
export type BoxEventType = 'archived' | 'retrieved' | 'empty_carton_issued';

export function applyBoxEvent(currentCount: number, eventType: BoxEventType, quantity: number): number {
    switch (eventType) {
        case 'archived':
            return currentCount + quantity;
        case 'retrieved': {
            const next = currentCount - quantity;
            if (next < 0) {
                throw new Error(`Insufficient boxes: department has ${currentCount}, cannot retrieve ${quantity}`);
            }
            return next;
        }
        case 'empty_carton_issued':
            return currentCount;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd warehouse-server && npx jest boxCount -v`
Expected: PASS, all 5 cases

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/utils/boxCount.ts warehouse-server/src/tests/boxCount.test.ts
git commit -m "feat(warehouse-server): add box-count transition logic with negative-count guard"
```

---

## Task 4: Validation middleware + Companies CRUD

**Files:**
- Create: `warehouse-server/src/middleware/validationMiddleware.ts`
- Create: `warehouse-server/src/schemas/companySchemas.ts`
- Create: `warehouse-server/src/controllers/companyController.ts`
- Create: `warehouse-server/src/routes/companyRoutes.ts`
- Modify: `warehouse-server/src/app.ts` (mount `/api/companies`)
- Test: `warehouse-server/src/tests/companies.test.ts`

**Interfaces:**
- Consumes: `execute` (Task 1), `authenticateToken`, `requireRole` (Task 2)
- Produces: `validateBody(schema: ZodSchema)` middleware from `middleware/validationMiddleware.ts` — reused by Tasks 5, 6
- Produces: `GET /api/companies` → array of `{ ID, NAME, CODE, CONTACT_PERSON, PHONE, EMAIL, ADDRESS, STATUS, DEPARTMENT_COUNT, TOTAL_BOX_COUNT }`
- Produces: `GET /api/companies/:id` → `{ ID, NAME, ..., DEPARTMENTS: [{ ID, NAME, CODE, STATUS, CURRENT_BOX_COUNT }] }`
- Produces: `POST /api/companies`, `PUT /api/companies/:id`

- [ ] **Step 1: Create `warehouse-server/src/middleware/validationMiddleware.ts`**

```typescript
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validateBody = (schema: ZodSchema) =>
    (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                message: 'Validation error',
                errors: result.error.issues.map(e => ({ field: e.path.map(String).join('.'), message: e.message })),
            });
        }
        req.body = result.data;
        next();
    };

export const validateQuery = (schema: ZodSchema) =>
    (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            return res.status(400).json({
                message: 'Validation error',
                errors: result.error.issues.map(e => ({ field: e.path.map(String).join('.'), message: e.message })),
            });
        }
        next();
    };
```

- [ ] **Step 2: Create `warehouse-server/src/schemas/companySchemas.ts`**

```typescript
import { z } from 'zod';

export const createCompanySchema = z.object({
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(32).optional(),
    contact_person: z.string().max(200).optional(),
    phone: z.string().max(64).optional(),
    email: z.string().email().max(200).optional(),
    address: z.string().optional(),
});

export const updateCompanySchema = z.object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(32).optional(),
    contact_person: z.string().max(200).optional(),
    phone: z.string().max(64).optional(),
    email: z.string().email().max(200).optional(),
    address: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });
```

- [ ] **Step 3: Create `warehouse-server/src/controllers/companyController.ts`**

```typescript
import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export const getCompanies = async (req: Request, res: Response) => {
    try {
        const result = await execute<any>(`
            SELECT c.id, c.name, c.code, c.contact_person, c.phone, c.email, c.address, c.status,
                   COUNT(d.id)::int AS department_count,
                   COALESCE(SUM(d.current_box_count), 0)::int AS total_box_count
            FROM companies c
            LEFT JOIN departments d ON d.company_id = c.id
            GROUP BY c.id
            ORDER BY c.name
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('getCompanies error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getCompanyById = async (req: Request, res: Response) => {
    try {
        const companyResult = await execute<any>(`SELECT * FROM companies WHERE id = :id`, [req.params.id]);
        if (companyResult.rows.length === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }
        const company = companyResult.rows[0];

        const deptResult = await execute<any>(
            `SELECT id, name, code, status, current_box_count FROM departments WHERE company_id = :id ORDER BY name`,
            [req.params.id]
        );
        company.DEPARTMENTS = deptResult.rows;

        res.json(company);
    } catch (err) {
        console.error('getCompanyById error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createCompany = async (req: Request, res: Response) => {
    const { name, code, contact_person, phone, email, address } = req.body;
    try {
        const result = await execute<any>(
            `INSERT INTO companies (name, code, contact_person, phone, email, address)
             VALUES (:name, :code, :contact_person, :phone, :email, :address)
             RETURNING *`,
            { name, code: code || null, contact_person: contact_person || null, phone: phone || null, email: email || null, address: address || null }
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createCompany error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateCompany = async (req: Request, res: Response) => {
    const fields = req.body;
    const setClauses = Object.keys(fields).map(key => `${key} = :${key}`).join(', ');
    try {
        const result = await execute<any>(
            `UPDATE companies SET ${setClauses} WHERE id = :id RETURNING *`,
            { ...fields, id: req.params.id }
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateCompany error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
```

- [ ] **Step 4: Create `warehouse-server/src/routes/companyRoutes.ts`**

```typescript
import { Router } from 'express';
import { getCompanies, getCompanyById, createCompany, updateCompany } from '../controllers/companyController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createCompanySchema, updateCompanySchema } from '../schemas/companySchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', getCompanies);
router.get('/:id', getCompanyById);
router.post('/', requireRole(['admin']), validateBody(createCompanySchema), createCompany);
router.put('/:id', requireRole(['admin']), validateBody(updateCompanySchema), updateCompany);

export default router;
```

- [ ] **Step 5: Modify `warehouse-server/src/app.ts` to mount company routes**

Add import:
```typescript
import companyRoutes from './routes/companyRoutes';
```

Add after the auth mount:
```typescript
app.use('/api/companies', companyRoutes);
```

- [ ] **Step 6: Write the failing test — `warehouse-server/src/tests/companies.test.ts`**

```typescript
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
```

- [ ] **Step 7: Run the tests**

Run: `cd warehouse-server && JWT_SECRET=test-secret npm test`
Expected: PASS for all suites so far.

- [ ] **Step 8: Commit**

```bash
git add warehouse-server/src/middleware/validationMiddleware.ts warehouse-server/src/schemas/companySchemas.ts warehouse-server/src/controllers/companyController.ts warehouse-server/src/routes/companyRoutes.ts warehouse-server/src/app.ts warehouse-server/src/tests/companies.test.ts
git commit -m "feat(warehouse-server): add companies CRUD API with validation"
```

---

## Task 5: Departments CRUD

**Files:**
- Create: `warehouse-server/src/schemas/departmentSchemas.ts`
- Create: `warehouse-server/src/controllers/departmentController.ts`
- Create: `warehouse-server/src/routes/departmentRoutes.ts`
- Modify: `warehouse-server/src/app.ts` (mount `/api/departments`)
- Test: `warehouse-server/src/tests/departments.test.ts`

**Interfaces:**
- Consumes: `execute` (Task 1), `authenticateToken`/`requireRole` (Task 2), `validateBody` (Task 4)
- Produces: `POST /api/departments` (body: `{ company_id, name, code? }`) → created department
- Produces: `PUT /api/departments/:id`, `GET /api/departments?company_id=`

- [ ] **Step 1: Create `warehouse-server/src/schemas/departmentSchemas.ts`**

```typescript
import { z } from 'zod';

export const createDepartmentSchema = z.object({
    company_id: z.number().int().positive(),
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(32).optional(),
});

export const updateDepartmentSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(32).optional(),
    status: z.enum(['active', 'inactive']).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });
```

- [ ] **Step 2: Create `warehouse-server/src/controllers/departmentController.ts`**

```typescript
import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export const getDepartments = async (req: Request, res: Response) => {
    const { company_id } = req.query;
    try {
        let query = `SELECT id, company_id, name, code, status, current_box_count FROM departments WHERE 1=1`;
        const params: any = {};
        if (company_id) {
            query += ` AND company_id = :company_id`;
            params.company_id = company_id;
        }
        query += ` ORDER BY name`;
        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getDepartments error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createDepartment = async (req: Request, res: Response) => {
    const { company_id, name, code } = req.body;
    try {
        const companyCheck = await execute<any>(`SELECT id FROM companies WHERE id = :company_id`, [company_id]);
        if (companyCheck.rows.length === 0) {
            return res.status(400).json({ message: 'company_id does not reference an existing company' });
        }

        const result = await execute<any>(
            `INSERT INTO departments (company_id, name, code) VALUES (:company_id, :name, :code) RETURNING *`,
            { company_id, name, code: code || null }
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'A department with this name already exists for this company' });
        }
        console.error('createDepartment error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateDepartment = async (req: Request, res: Response) => {
    const fields = req.body;
    const setClauses = Object.keys(fields).map(key => `${key} = :${key}`).join(', ');
    try {
        const result = await execute<any>(
            `UPDATE departments SET ${setClauses} WHERE id = :id RETURNING *`,
            { ...fields, id: req.params.id }
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Department not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateDepartment error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
```

- [ ] **Step 3: Create `warehouse-server/src/routes/departmentRoutes.ts`**

```typescript
import { Router } from 'express';
import { getDepartments, createDepartment, updateDepartment } from '../controllers/departmentController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createDepartmentSchema, updateDepartmentSchema } from '../schemas/departmentSchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', getDepartments);
router.post('/', requireRole(['admin']), validateBody(createDepartmentSchema), createDepartment);
router.put('/:id', requireRole(['admin']), validateBody(updateDepartmentSchema), updateDepartment);

export default router;
```

- [ ] **Step 4: Modify `warehouse-server/src/app.ts` to mount department routes**

Add import:
```typescript
import departmentRoutes from './routes/departmentRoutes';
```

Add after the companies mount:
```typescript
app.use('/api/departments', departmentRoutes);
```

- [ ] **Step 5: Write the failing test — `warehouse-server/src/tests/departments.test.ts`**

```typescript
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

import departmentRoutes from '../routes/departmentRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/departments', departmentRoutes);

describe('Departments API', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('POST rejects when company_id does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] }); // company check

        const res = await request(app).post('/api/departments').send({ company_id: 999, name: 'CASH DEPT' });

        expect(res.status).toBe(400);
    });

    it('POST creates a department when company exists', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // company check
            .mockResolvedValueOnce({ rows: [{ ID: 10, COMPANY_ID: 1, NAME: 'CASH DEPT', CURRENT_BOX_COUNT: 0 }] }); // insert

        const res = await request(app).post('/api/departments').send({ company_id: 1, name: 'CASH DEPT' });

        expect(res.status).toBe(201);
        expect(res.body.NAME).toBe('CASH DEPT');
    });

    it('GET filters by company_id', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 10, NAME: 'CASH DEPT' }] });

        const res = await request(app).get('/api/departments?company_id=1');

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[0][0]).toMatch(/AND company_id = :company_id/);
    });
});
```

- [ ] **Step 6: Run the tests**

Run: `cd warehouse-server && JWT_SECRET=test-secret npm test`
Expected: PASS for all suites so far.

- [ ] **Step 7: Commit**

```bash
git add warehouse-server/src/schemas/departmentSchemas.ts warehouse-server/src/controllers/departmentController.ts warehouse-server/src/routes/departmentRoutes.ts warehouse-server/src/app.ts warehouse-server/src/tests/departments.test.ts
git commit -m "feat(warehouse-server): add departments CRUD API"
```

---

## Task 6: Box events endpoint (the running-total transaction)

**Files:**
- Create: `warehouse-server/src/schemas/boxEventSchemas.ts`
- Create: `warehouse-server/src/controllers/boxEventController.ts`
- Create: `warehouse-server/src/routes/boxEventRoutes.ts`
- Modify: `warehouse-server/src/app.ts` (mount `/api/box-events`)
- Test: `warehouse-server/src/tests/boxEvents.test.ts`

**Interfaces:**
- Consumes: `withTransaction` (Task 1), `applyBoxEvent` (Task 3), `authenticateToken` (Task 2), `validateBody` (Task 4)
- Produces: `POST /api/box-events` (body: `{ department_id, event_type, quantity, event_date, reference_no?, remarks? }`) → `201` with created event, or `400` with `{ message: 'Insufficient boxes...' }` if it would go negative
- Produces: `GET /api/box-events?department_id=&event_type=&from=&to=` → paginated-free list, newest first

- [ ] **Step 1: Create `warehouse-server/src/schemas/boxEventSchemas.ts`**

```typescript
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');

export const createBoxEventSchema = z.object({
    department_id: z.number().int().positive(),
    event_type: z.enum(['archived', 'retrieved', 'empty_carton_issued']),
    quantity: z.number().int().positive(),
    event_date: dateStr,
    reference_no: z.string().max(64).optional(),
    remarks: z.string().optional(),
});

export const boxEventQuerySchema = z.object({
    department_id: z.string().optional(),
    event_type: z.enum(['archived', 'retrieved', 'empty_carton_issued']).optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
});
```

- [ ] **Step 2: Create `warehouse-server/src/controllers/boxEventController.ts`**

```typescript
import { Request, Response } from 'express';
import { execute, withTransaction } from '../db/dbUtils';
import { applyBoxEvent, BoxEventType } from '../utils/boxCount';

export const createBoxEvent = async (req: Request, res: Response) => {
    const { department_id, event_type, quantity, event_date, reference_no, remarks } = req.body;
    const userId = (req as any).user?.id ?? null;

    try {
        const event = await withTransaction(async (exec) => {
            const deptResult = await exec<any>(
                `SELECT id, current_box_count FROM departments WHERE id = :department_id FOR UPDATE`,
                { department_id }
            );
            if (deptResult.rows.length === 0) {
                throw Object.assign(new Error('Department not found'), { statusCode: 404 });
            }

            const currentCount = deptResult.rows[0].CURRENT_BOX_COUNT;
            let newCount: number;
            try {
                newCount = applyBoxEvent(currentCount, event_type as BoxEventType, quantity);
            } catch (e: any) {
                throw Object.assign(e, { statusCode: 400 });
            }

            await exec(
                `UPDATE departments SET current_box_count = :new_count WHERE id = :department_id`,
                { new_count: newCount, department_id }
            );

            const insertResult = await exec<any>(
                `INSERT INTO box_events (department_id, event_type, quantity, event_date, reference_no, remarks, created_by)
                 VALUES (:department_id, :event_type, :quantity, :event_date, :reference_no, :remarks, :created_by)
                 RETURNING *`,
                { department_id, event_type, quantity, event_date, reference_no: reference_no || null, remarks: remarks || null, created_by: userId }
            );

            return insertResult.rows[0];
        });

        res.status(201).json(event);
    } catch (err: any) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ message: err.message });
        }
        console.error('createBoxEvent error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getBoxEvents = async (req: Request, res: Response) => {
    const { department_id, event_type, from, to } = req.query;
    try {
        let query = `
            SELECT be.id, be.department_id, be.event_type, be.quantity, be.event_date, be.reference_no, be.remarks, be.created_at,
                   d.name AS department_name, c.name AS company_name
            FROM box_events be
            JOIN departments d ON d.id = be.department_id
            JOIN companies c ON c.id = d.company_id
            WHERE 1=1
        `;
        const params: any = {};

        if (department_id) { query += ` AND be.department_id = :department_id`; params.department_id = department_id; }
        if (event_type) { query += ` AND be.event_type = :event_type`; params.event_type = event_type; }
        if (from) { query += ` AND be.event_date >= :from`; params.from = from; }
        if (to) { query += ` AND be.event_date <= :to`; params.to = to; }

        query += ` ORDER BY be.event_date DESC, be.id DESC LIMIT 500`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getBoxEvents error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
```

- [ ] **Step 3: Create `warehouse-server/src/routes/boxEventRoutes.ts`**

```typescript
import { Router } from 'express';
import { createBoxEvent, getBoxEvents } from '../controllers/boxEventController';
import { authenticateToken } from '../middleware/authMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { createBoxEventSchema, boxEventQuerySchema } from '../schemas/boxEventSchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', validateQuery(boxEventQuerySchema), getBoxEvents);
router.post('/', validateBody(createBoxEventSchema), createBoxEvent);

export default router;
```

- [ ] **Step 4: Modify `warehouse-server/src/app.ts` to mount box-event routes**

Add import:
```typescript
import boxEventRoutes from './routes/boxEventRoutes';
```

Add after the departments mount:
```typescript
app.use('/api/box-events', boxEventRoutes);
```

- [ ] **Step 5: Write the failing test — `warehouse-server/src/tests/boxEvents.test.ts`**

```typescript
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
```

- [ ] **Step 6: Run the tests**

Run: `cd warehouse-server && JWT_SECRET=test-secret npm test`
Expected: PASS for all suites, including the negative-count rejection test.

- [ ] **Step 7: Commit**

```bash
git add warehouse-server/src/schemas/boxEventSchemas.ts warehouse-server/src/controllers/boxEventController.ts warehouse-server/src/routes/boxEventRoutes.ts warehouse-server/src/app.ts warehouse-server/src/tests/boxEvents.test.ts
git commit -m "feat(warehouse-server): add box-events endpoint with transactional running-total update"
```

---

## Task 7: Summary endpoints

**Files:**
- Create: `warehouse-server/src/controllers/summaryController.ts`
- Create: `warehouse-server/src/routes/summaryRoutes.ts`
- Modify: `warehouse-server/src/app.ts` (mount `/api/summary`)
- Test: `warehouse-server/src/tests/summary.test.ts`

**Interfaces:**
- Consumes: `execute` (Task 1), `authenticateToken` (Task 2)
- Produces: `GET /api/summary/companies` → `[{ COMPANY_ID, COMPANY_NAME, TOTAL_BOX_COUNT }]`
- Produces: `GET /api/summary/monthly?from=&to=` → `[{ MONTH: 'YYYY-MM-01', ARCHIVED: n, RETRIEVED: n, EMPTY_CARTON_ISSUED: n }]`

- [ ] **Step 1: Create `warehouse-server/src/controllers/summaryController.ts`**

```typescript
import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export const getCompanySummary = async (req: Request, res: Response) => {
    try {
        const result = await execute<any>(`
            SELECT c.id AS company_id, c.name AS company_name,
                   COALESCE(SUM(d.current_box_count), 0)::int AS total_box_count
            FROM companies c
            LEFT JOIN departments d ON d.company_id = c.id
            WHERE c.status = 'active'
            GROUP BY c.id, c.name
            ORDER BY total_box_count DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('getCompanySummary error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getMonthlySummary = async (req: Request, res: Response) => {
    const { from, to } = req.query;
    try {
        let query = `
            SELECT date_trunc('month', event_date)::date AS month,
                   SUM(CASE WHEN event_type = 'archived' THEN quantity ELSE 0 END)::int AS archived,
                   SUM(CASE WHEN event_type = 'retrieved' THEN quantity ELSE 0 END)::int AS retrieved,
                   SUM(CASE WHEN event_type = 'empty_carton_issued' THEN quantity ELSE 0 END)::int AS empty_carton_issued
            FROM box_events
            WHERE 1=1
        `;
        const params: any = {};
        if (from) { query += ` AND event_date >= :from`; params.from = from; }
        if (to) { query += ` AND event_date <= :to`; params.to = to; }
        query += ` GROUP BY month ORDER BY month`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getMonthlySummary error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
```

- [ ] **Step 2: Create `warehouse-server/src/routes/summaryRoutes.ts`**

```typescript
import { Router } from 'express';
import { getCompanySummary, getMonthlySummary } from '../controllers/summaryController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/companies', getCompanySummary);
router.get('/monthly', getMonthlySummary);

export default router;
```

- [ ] **Step 3: Modify `warehouse-server/src/app.ts` to mount summary routes**

Add import:
```typescript
import summaryRoutes from './routes/summaryRoutes';
```

Add after the box-events mount:
```typescript
app.use('/api/summary', summaryRoutes);
```

- [ ] **Step 4: Write the failing test — `warehouse-server/src/tests/summary.test.ts`**

```typescript
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
```

- [ ] **Step 5: Run the full backend test suite**

Run: `cd warehouse-server && JWT_SECRET=test-secret npm test`
Expected: PASS for every suite created in Tasks 1–7.

- [ ] **Step 6: Commit**

```bash
git add warehouse-server/src/controllers/summaryController.ts warehouse-server/src/routes/summaryRoutes.ts warehouse-server/src/app.ts warehouse-server/src/tests/summary.test.ts
git commit -m "feat(warehouse-server): add company and monthly summary endpoints"
```

---

## Task 8: Frontend scaffold — login, routing, layout shell

**Files:**
- Create: `warehouse-client/package.json`
- Create: `warehouse-client/vite.config.ts`
- Create: `warehouse-client/tsconfig.json`, `warehouse-client/tsconfig.app.json`, `warehouse-client/tsconfig.node.json`
- Create: `warehouse-client/index.html`
- Create: `warehouse-client/postcss.config.js`
- Create: `warehouse-client/src/index.css`
- Create: `warehouse-client/src/main.tsx`
- Create: `warehouse-client/src/types.ts`
- Create: `warehouse-client/src/services/api.ts`
- Create: `warehouse-client/src/context/AuthContext.tsx`
- Create: `warehouse-client/src/components/Layout.tsx`
- Create: `warehouse-client/src/pages/Login.tsx`
- Create: `warehouse-client/src/App.tsx`

**Interfaces:**
- Consumes: backend contracts from Tasks 2, 4, 5, 6, 7 (`POST /api/auth/login`, company/department/box-event/summary shapes)
- Produces: `api` (axios instance) from `services/api.ts`, `useAuth()` from `context/AuthContext.tsx`, `<Layout>` shell with `<Outlet/>` — consumed by every page task (9–12)

- [ ] **Step 1: Create `warehouse-client/package.json`**

```json
{
  "name": "warehouse-client",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "axios": "^1.13.4",
    "date-fns": "^4.1.0",
    "lucide-react": "^0.563.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-hot-toast": "^2.6.0",
    "react-router-dom": "^7.13.0",
    "recharts": "^3.7.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.18",
    "@types/node": "^24.10.1",
    "@types/react": "^19.2.5",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.1",
    "autoprefixer": "^10.4.24",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.18",
    "typescript": "^5.7.2",
    "vite": "^7.2.4"
  }
}
```

- [ ] **Step 2: Create `warehouse-client/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'http://localhost:5100',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 3: Create `warehouse-client/tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

- [ ] **Step 4: Create `warehouse-client/tsconfig.app.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `warehouse-client/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 6: Create `warehouse-client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DOK Warehouse</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `warehouse-client/postcss.config.js`**

```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 8: Create `warehouse-client/src/index.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 9: Create `warehouse-client/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 10: Create `warehouse-client/src/types.ts`**

```typescript
export interface WhUser {
    ID: number;
    USERNAME: string;
    NAME: string;
    ROLE: 'admin' | 'staff';
    STATUS: 'active' | 'inactive';
}

export interface LoginResponse {
    token: string;
    user: WhUser;
}

export interface Company {
    ID: number;
    NAME: string;
    CODE: string | null;
    CONTACT_PERSON: string | null;
    PHONE: string | null;
    EMAIL: string | null;
    ADDRESS: string | null;
    STATUS: 'active' | 'inactive';
    DEPARTMENT_COUNT?: number;
    TOTAL_BOX_COUNT?: number;
    DEPARTMENTS?: Department[];
}

export interface Department {
    ID: number;
    COMPANY_ID: number;
    NAME: string;
    CODE: string | null;
    STATUS: 'active' | 'inactive';
    CURRENT_BOX_COUNT: number;
}

export type BoxEventType = 'archived' | 'retrieved' | 'empty_carton_issued';

export interface BoxEvent {
    ID: number;
    DEPARTMENT_ID: number;
    DEPARTMENT_NAME?: string;
    COMPANY_NAME?: string;
    EVENT_TYPE: BoxEventType;
    QUANTITY: number;
    EVENT_DATE: string;
    REFERENCE_NO: string | null;
    REMARKS: string | null;
    CREATED_AT: string;
}

export interface CompanySummaryRow {
    COMPANY_ID: number;
    COMPANY_NAME: string;
    TOTAL_BOX_COUNT: number;
}

export interface MonthlySummaryRow {
    MONTH: string;
    ARCHIVED: number;
    RETRIEVED: number;
    EMPTY_CARTON_ISSUED: number;
}
```

- [ ] **Step 11: Create `warehouse-client/src/services/api.ts`**

```typescript
import axios from 'axios';

const api = axios.create({
    baseURL: '/api',
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('wh_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            if (!window.location.pathname.includes('/login')) {
                localStorage.removeItem('wh_token');
                localStorage.removeItem('wh_user');
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

export default api;
```

- [ ] **Step 12: Create `warehouse-client/src/context/AuthContext.tsx`**

```tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { LoginResponse, WhUser } from '../types';

interface AuthContextType {
    user: WhUser | null;
    login: (data: LoginResponse) => void;
    logout: () => void;
    isAuthenticated: boolean;
    isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<WhUser | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const storedToken = localStorage.getItem('wh_token');
        const storedUser = localStorage.getItem('wh_user');
        if (storedToken && storedUser) {
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
        }
        setIsLoading(false);
    }, []);

    const login = (data: LoginResponse) => {
        localStorage.setItem('wh_token', data.token);
        localStorage.setItem('wh_user', JSON.stringify(data.user));
        setToken(data.token);
        setUser(data.user);
    };

    const logout = () => {
        localStorage.removeItem('wh_token');
        localStorage.removeItem('wh_user');
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!token, isLoading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};
```

- [ ] **Step 13: Create `warehouse-client/src/components/Layout.tsx`**

```tsx
import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Building2, PackageSearch, BarChart3, LogOut } from 'lucide-react';

const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/companies', label: 'Companies', icon: Building2 },
    { to: '/box-events', label: 'Box Events', icon: PackageSearch },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
];

const Layout: React.FC = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="flex h-screen bg-slate-50">
            <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
                <div className="p-4 border-b border-slate-200">
                    <h1 className="font-bold text-lg text-slate-800">DOK Warehouse</h1>
                </div>
                <nav className="flex-1 p-3 space-y-1">
                    {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={to === '/'}
                            className={({ isActive }) =>
                                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                                    isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                                }`
                            }
                        >
                            <Icon size={18} />
                            {label}
                        </NavLink>
                    ))}
                </nav>
                <div className="p-3 border-t border-slate-200">
                    <div className="text-sm text-slate-500 mb-2">{user?.NAME}</div>
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 w-full"
                    >
                        <LogOut size={18} />
                        Logout
                    </button>
                </div>
            </aside>
            <main className="flex-1 overflow-auto p-6">
                <Outlet />
            </main>
        </div>
    );
};

export default Layout;
```

- [ ] **Step 14: Create `warehouse-client/src/pages/Login.tsx`**

```tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { LoginResponse } from '../types';

const Login: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await api.post<LoginResponse>('/auth/login', { username, password });
            login(res.data);
            navigate('/');
        } catch (err) {
            toast.error('Invalid username or password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center h-screen bg-slate-50">
            <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 w-80">
                <h1 className="text-xl font-bold text-slate-800 mb-6">DOK Warehouse Login</h1>
                <label className="block text-sm font-medium text-slate-600 mb-1">Username</label>
                <input
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                />
                <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
                <input
                    type="password"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-6"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? 'Signing in...' : 'Sign in'}
                </button>
            </form>
        </div>
    );
};

export default Login;
```

- [ ] **Step 15: Create `warehouse-client/src/App.tsx`**

```tsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';

const LoadingScreen = () => (
    <div className="flex items-center justify-center h-screen">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
);

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated, isLoading } = useAuth();
    if (isLoading) return <LoadingScreen />;
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    return <>{children}</>;
};

function AppRoutes() {
    return (
        <Router>
            <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                    path="/"
                    element={
                        <ProtectedRoute>
                            <Layout />
                        </ProtectedRoute>
                    }
                >
                    <Route index element={<div>Dashboard placeholder</div>} />
                </Route>
            </Routes>
        </Router>
    );
}

function App() {
    return (
        <AuthProvider>
            <AppRoutes />
            <Toaster position="top-right" />
        </AuthProvider>
    );
}

export default App;
```

Note: `AuthProvider` must be inside `Router` for `useAuth`'s consumers that need routing, but here `Router` wraps `AuthProvider`'s consumer (`AppRoutes`) while `AuthProvider` itself is outside `Router` — this is intentional and matches the DOK-HR app's structure, since `AuthProvider` here doesn't call `useNavigate` (unlike DOK-HR's version, which was simplified in Step 12 to drop the session-timeout modal).

- [ ] **Step 16: Install dependencies and verify the build**

Run:
```bash
cd warehouse-client
npm install
npm run build
```
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 17: Manually verify login renders**

Run:
```bash
npm run dev
```
Open `http://localhost:5175` in a browser (with `warehouse-server` also running via `npm run dev` in another terminal, and `WH_DB_*`/`JWT_SECRET` configured against a real Postgres instance). Confirm the login form renders and submitting valid seeded credentials (`admin` / `password123`, after running `npm run seed` in `warehouse-server`) redirects to `/` showing "Dashboard placeholder". Stop both dev servers after verifying.

- [ ] **Step 18: Commit**

```bash
git add warehouse-client
git commit -m "feat(warehouse-client): scaffold React+Vite+Tailwind frontend with login and layout shell"
```

---

## Task 9: Dashboard page

**Files:**
- Create: `warehouse-client/src/pages/Dashboard.tsx`
- Modify: `warehouse-client/src/App.tsx` (replace placeholder route with `<Dashboard />`)

**Interfaces:**
- Consumes: `api` (Task 8), `GET /api/summary/companies`, `GET /api/box-events` (Task 6/7), types `CompanySummaryRow`, `BoxEvent` (Task 8)

- [ ] **Step 1: Create `warehouse-client/src/pages/Dashboard.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import api from '../services/api';
import type { CompanySummaryRow, BoxEvent } from '../types';

const Dashboard: React.FC = () => {
    const [companies, setCompanies] = useState<CompanySummaryRow[]>([]);
    const [recentEvents, setRecentEvents] = useState<BoxEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            api.get<CompanySummaryRow[]>('/summary/companies'),
            api.get<BoxEvent[]>('/box-events'),
        ]).then(([companiesRes, eventsRes]) => {
            setCompanies(companiesRes.data);
            setRecentEvents(eventsRes.data.slice(0, 10));
        }).finally(() => setLoading(false));
    }, []);

    const totalBoxes = companies.reduce((sum, c) => sum + c.TOTAL_BOX_COUNT, 0);

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>

            <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-sm text-slate-500">Total Boxes in Storage</div>
                    <div className="text-3xl font-bold text-slate-800">{totalBoxes.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-sm text-slate-500">Active Companies</div>
                    <div className="text-3xl font-bold text-slate-800">{companies.length}</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-sm text-slate-500">Recent Events</div>
                    <div className="text-3xl font-bold text-slate-800">{recentEvents.length}</div>
                </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200">
                <div className="p-4 border-b border-slate-200 font-semibold text-slate-700">Recent Box Events</div>
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Date</th>
                            <th className="p-3">Company</th>
                            <th className="p-3">Department</th>
                            <th className="p-3">Type</th>
                            <th className="p-3">Qty</th>
                        </tr>
                    </thead>
                    <tbody>
                        {recentEvents.map((e) => (
                            <tr key={e.ID} className="border-t border-slate-100">
                                <td className="p-3">{e.EVENT_DATE}</td>
                                <td className="p-3">{e.COMPANY_NAME}</td>
                                <td className="p-3">{e.DEPARTMENT_NAME}</td>
                                <td className="p-3 capitalize">{e.EVENT_TYPE.replace('_', ' ')}</td>
                                <td className="p-3">{e.QUANTITY}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Dashboard;
```

- [ ] **Step 2: Modify `warehouse-client/src/App.tsx` to route to Dashboard**

Add import:
```tsx
import Dashboard from './pages/Dashboard';
```

Replace `<Route index element={<div>Dashboard placeholder</div>} />` with:
```tsx
<Route index element={<Dashboard />} />
```

- [ ] **Step 3: Verify the build**

Run: `cd warehouse-client && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add warehouse-client/src/pages/Dashboard.tsx warehouse-client/src/App.tsx
git commit -m "feat(warehouse-client): add dashboard page with totals and recent events"
```

---

## Task 10: Companies list + detail pages

**Files:**
- Create: `warehouse-client/src/pages/Companies.tsx`
- Create: `warehouse-client/src/pages/CompanyDetail.tsx`
- Modify: `warehouse-client/src/App.tsx` (add `/companies` and `/companies/:id` routes)

**Interfaces:**
- Consumes: `api` (Task 8), `GET/POST /api/companies`, `GET /api/companies/:id`, `POST /api/departments` (Tasks 4, 5), types `Company`, `Department`

- [ ] **Step 1: Create `warehouse-client/src/pages/Companies.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import type { Company } from '../types';

const Companies: React.FC = () => {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [code, setCode] = useState('');

    const load = () => {
        setLoading(true);
        api.get<Company[]>('/companies').then((res) => setCompanies(res.data)).finally(() => setLoading(false));
    };

    useEffect(load, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/companies', { name, code: code || undefined });
            toast.success('Company created');
            setName('');
            setCode('');
            setShowForm(false);
            load();
        } catch {
            toast.error('Failed to create company');
        }
    };

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Companies</h1>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
                >
                    {showForm ? 'Cancel' : 'New Company'}
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-4 flex gap-3 items-end">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Code</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={code} onChange={(e) => setCode(e.target.value)} />
                    </div>
                    <button type="submit" className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700">
                        Save
                    </button>
                </form>
            )}

            <div className="bg-white rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Name</th>
                            <th className="p-3">Code</th>
                            <th className="p-3">Departments</th>
                            <th className="p-3">Total Boxes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {companies.map((c) => (
                            <tr key={c.ID} className="border-t border-slate-100 hover:bg-slate-50">
                                <td className="p-3">
                                    <Link to={`/companies/${c.ID}`} className="text-blue-600 font-medium">{c.NAME}</Link>
                                </td>
                                <td className="p-3">{c.CODE}</td>
                                <td className="p-3">{c.DEPARTMENT_COUNT}</td>
                                <td className="p-3">{c.TOTAL_BOX_COUNT}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Companies;
```

- [ ] **Step 2: Create `warehouse-client/src/pages/CompanyDetail.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import type { Company } from '../types';

const CompanyDetail: React.FC = () => {
    const { id } = useParams();
    const [company, setCompany] = useState<Company | null>(null);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [deptName, setDeptName] = useState('');
    const [deptCode, setDeptCode] = useState('');

    const load = () => {
        setLoading(true);
        api.get<Company>(`/companies/${id}`).then((res) => setCompany(res.data)).finally(() => setLoading(false));
    };

    useEffect(load, [id]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/departments', { company_id: Number(id), name: deptName, code: deptCode || undefined });
            toast.success('Department created');
            setDeptName('');
            setDeptCode('');
            setShowForm(false);
            load();
        } catch {
            toast.error('Failed to create department');
        }
    };

    if (loading || !company) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">{company.NAME}</h1>
            <div className="text-sm text-slate-500">{company.CODE}</div>

            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-700">Departments</h2>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
                >
                    {showForm ? 'Cancel' : 'New Department'}
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-4 flex gap-3 items-end">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={deptName} onChange={(e) => setDeptName(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Code</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={deptCode} onChange={(e) => setDeptCode(e.target.value)} />
                    </div>
                    <button type="submit" className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700">
                        Save
                    </button>
                </form>
            )}

            <div className="bg-white rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Name</th>
                            <th className="p-3">Code</th>
                            <th className="p-3">Current Box Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(company.DEPARTMENTS || []).map((d) => (
                            <tr key={d.ID} className="border-t border-slate-100">
                                <td className="p-3">{d.NAME}</td>
                                <td className="p-3">{d.CODE}</td>
                                <td className="p-3">{d.CURRENT_BOX_COUNT}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default CompanyDetail;
```

- [ ] **Step 3: Modify `warehouse-client/src/App.tsx` to add routes**

Add imports:
```tsx
import Companies from './pages/Companies';
import CompanyDetail from './pages/CompanyDetail';
```

Add inside the `<Route path="/" element={...}>` block, after the `index` route:
```tsx
<Route path="companies" element={<Companies />} />
<Route path="companies/:id" element={<CompanyDetail />} />
```

- [ ] **Step 4: Verify the build**

Run: `cd warehouse-client && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add warehouse-client/src/pages/Companies.tsx warehouse-client/src/pages/CompanyDetail.tsx warehouse-client/src/App.tsx
git commit -m "feat(warehouse-client): add companies list and company detail pages"
```

---

## Task 11: Box Events page

**Files:**
- Create: `warehouse-client/src/pages/BoxEvents.tsx`
- Modify: `warehouse-client/src/App.tsx` (add `/box-events` route)

**Interfaces:**
- Consumes: `api` (Task 8), `GET /api/companies` (for the department picker, Task 4), `GET/POST /api/box-events` (Task 6), types `Company`, `BoxEvent`

- [ ] **Step 1: Create `warehouse-client/src/pages/BoxEvents.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import type { Company, BoxEvent, BoxEventType } from '../types';

const EVENT_TYPES: { value: BoxEventType; label: string }[] = [
    { value: 'archived', label: 'Archived (new boxes)' },
    { value: 'retrieved', label: 'Retrieved' },
    { value: 'empty_carton_issued', label: 'Empty Carton Issued' },
];

const BoxEvents: React.FC = () => {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [events, setEvents] = useState<BoxEvent[]>([]);
    const [loading, setLoading] = useState(true);

    const [companyId, setCompanyId] = useState('');
    const [departmentId, setDepartmentId] = useState('');
    const [eventType, setEventType] = useState<BoxEventType>('archived');
    const [quantity, setQuantity] = useState('');
    const [eventDate, setEventDate] = useState('');
    const [referenceNo, setReferenceNo] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const loadEvents = () => {
        api.get<BoxEvent[]>('/box-events').then((res) => setEvents(res.data));
    };

    useEffect(() => {
        Promise.all([
            api.get<Company[]>('/companies'),
            api.get<BoxEvent[]>('/box-events'),
        ]).then(([companiesRes, eventsRes]) => {
            setCompanies(companiesRes.data);
            setEvents(eventsRes.data);
        }).finally(() => setLoading(false));
    }, []);

    const selectedCompany = companies.find((c) => String(c.ID) === companyId);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/box-events', {
                department_id: Number(departmentId),
                event_type: eventType,
                quantity: Number(quantity),
                event_date: eventDate,
                reference_no: referenceNo || undefined,
            });
            toast.success('Event logged');
            setQuantity('');
            setReferenceNo('');
            loadEvents();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to log event');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Box Events</h1>

            <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-6 gap-3 items-end">
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Company</label>
                    <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setDepartmentId(''); }} required>
                        <option value="">Select...</option>
                        {companies.map((c) => (
                            <option key={c.ID} value={c.ID}>{c.NAME}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Department</label>
                    <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required disabled={!selectedCompany}>
                        <option value="">Select...</option>
                        {(selectedCompany?.DEPARTMENTS || []).map((d) => (
                            <option key={d.ID} value={d.ID}>{d.NAME} ({d.CURRENT_BOX_COUNT})</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Event Type</label>
                    <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={eventType} onChange={(e) => setEventType(e.target.value as BoxEventType)}>
                        {EVENT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Quantity</label>
                    <input type="number" min="1" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
                    <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Reference No.</label>
                    <input className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
                </div>
                <div className="col-span-6">
                    <button type="submit" disabled={submitting} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {submitting ? 'Logging...' : 'Log Event'}
                    </button>
                </div>
            </form>

            <div className="bg-white rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Date</th>
                            <th className="p-3">Company</th>
                            <th className="p-3">Department</th>
                            <th className="p-3">Type</th>
                            <th className="p-3">Qty</th>
                            <th className="p-3">Reference</th>
                        </tr>
                    </thead>
                    <tbody>
                        {events.map((e) => (
                            <tr key={e.ID} className="border-t border-slate-100">
                                <td className="p-3">{e.EVENT_DATE}</td>
                                <td className="p-3">{e.COMPANY_NAME}</td>
                                <td className="p-3">{e.DEPARTMENT_NAME}</td>
                                <td className="p-3 capitalize">{e.EVENT_TYPE.replace('_', ' ')}</td>
                                <td className="p-3">{e.QUANTITY}</td>
                                <td className="p-3">{e.REFERENCE_NO}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default BoxEvents;
```

- [ ] **Step 2: Modify `warehouse-client/src/App.tsx` to add the route**

Add import:
```tsx
import BoxEvents from './pages/BoxEvents';
```

Add inside the `<Route path="/" element={...}>` block:
```tsx
<Route path="box-events" element={<BoxEvents />} />
```

- [ ] **Step 3: Verify the build**

Run: `cd warehouse-client && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add warehouse-client/src/pages/BoxEvents.tsx warehouse-client/src/App.tsx
git commit -m "feat(warehouse-client): add box events logging form and history table"
```

---

## Task 12: Reports page

**Files:**
- Create: `warehouse-client/src/pages/Reports.tsx`
- Modify: `warehouse-client/src/App.tsx` (add `/reports` route)

**Interfaces:**
- Consumes: `api` (Task 8), `GET /api/summary/companies`, `GET /api/summary/monthly` (Task 7), types `CompanySummaryRow`, `MonthlySummaryRow`

- [ ] **Step 1: Create `warehouse-client/src/pages/Reports.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../services/api';
import type { CompanySummaryRow, MonthlySummaryRow } from '../types';

const Reports: React.FC = () => {
    const [companySummary, setCompanySummary] = useState<CompanySummaryRow[]>([]);
    const [monthlySummary, setMonthlySummary] = useState<MonthlySummaryRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            api.get<CompanySummaryRow[]>('/summary/companies'),
            api.get<MonthlySummaryRow[]>('/summary/monthly'),
        ]).then(([companyRes, monthlyRes]) => {
            setCompanySummary(companyRes.data);
            setMonthlySummary(monthlyRes.data);
        }).finally(() => setLoading(false));
    }, []);

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Reports</h1>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h2 className="font-semibold text-slate-700 mb-4">Monthly Box Activity</h2>
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={monthlySummary}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="MONTH" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="ARCHIVED" fill="#2563eb" name="Archived" />
                        <Bar dataKey="RETRIEVED" fill="#dc2626" name="Retrieved" />
                        <Bar dataKey="EMPTY_CARTON_ISSUED" fill="#16a34a" name="Empty Cartons" />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-xl border border-slate-200">
                <div className="p-4 border-b border-slate-200 font-semibold text-slate-700">Company-wise Box Summary</div>
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Company</th>
                            <th className="p-3">Total Boxes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {companySummary.map((c) => (
                            <tr key={c.COMPANY_ID} className="border-t border-slate-100">
                                <td className="p-3">{c.COMPANY_NAME}</td>
                                <td className="p-3">{c.TOTAL_BOX_COUNT.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Reports;
```

- [ ] **Step 2: Modify `warehouse-client/src/App.tsx` to add the route**

Add import:
```tsx
import Reports from './pages/Reports';
```

Add inside the `<Route path="/" element={...}>` block:
```tsx
<Route path="reports" element={<Reports />} />
```

- [ ] **Step 3: Verify the build**

Run: `cd warehouse-client && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Manual end-to-end verification**

With `warehouse-server` running (Postgres reachable, `.env` configured, `npm run seed` already run) and `warehouse-client` running (`npm run dev`):
1. Log in as `admin` / `password123`.
2. Create a company (e.g. "Test Company", code "TEST").
3. Open its detail page, create a department (e.g. "CASH DEPT").
4. Go to Box Events, log an `archived` event of quantity 50 for that department; confirm it appears in the history table and the department's box count updates when revisiting the company detail page.
5. Log a `retrieved` event of quantity 60 for the same department (more than it has) and confirm the API rejects it with an error toast, and no row is added.
6. Log a valid `retrieved` event of quantity 20; confirm the count drops to 30.
7. Open Reports and confirm the monthly chart and company summary table reflect the events logged.

- [ ] **Step 5: Commit**

```bash
git add warehouse-client/src/pages/Reports.tsx warehouse-client/src/App.tsx
git commit -m "feat(warehouse-client): add reports page with monthly chart and company summary"
```

---

## Post-plan notes

- This repo is not a git repository yet (`git init` has not been run). Every "Commit" step above assumes git is available — if it isn't, run `git init` in the repo root first, or skip the commit steps and commit manually once the repo is initialized.
- A real PostgreSQL instance (`dok_warehouse` database, matching `warehouse-server/.env`) is required for `npm run seed`, `npm run dev`, and the Task 8/12 manual verification steps — the automated Jest suites (Tasks 1–7) all mock `dbUtils`, so `npm test` in `warehouse-server` does not require a live database.
- Out of scope per the spec: billing/invoicing, revenue reporting, expense tracking, individual box barcoding, any integration with the existing DOK-HR app. These are separate future plans.
