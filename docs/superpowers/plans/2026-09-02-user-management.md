# User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a real way to create/edit/deactivate user accounts (replacing the single-user seed script), and let any user change their own password — with a guard that prevents the last active admin from being demoted or deactivated.

**Architecture:** Extends the existing `warehouse-server`/`warehouse-client` app. Backend: a `userController`/`userRoutes`/`userSchemas` trio mirroring the existing `warehouseController` pattern (list/detail/create/update, admin-gated), plus a self-service `POST /users/me/change-password` endpoint (any authenticated user), plus a pure `wouldRemoveLastAdmin` guard function (TDD'd standalone, then wired into `updateUser`). Frontend: a new admin-only Users page mirroring the Warehouses page, plus a Change Password modal added to the sidebar.

**Tech Stack:** Same as the rest of `warehouse-server`/`warehouse-client` — Express 5 + TypeScript + `pg` + zod + bcrypt + Jest/supertest (backend), React 19 + TypeScript + TailwindCSS + `lucide-react` (frontend). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-02-user-management-design.md](../specs/2026-09-02-user-management-design.md)

## Global Constraints

- No new tables/columns — the existing `users` table (`id, username, password_hash, name, role, status, created_at`) already has everything this module needs.
- `GET /users` and `GET /users/:id` are admin-only (unlike Companies/Warehouses, which allow any authenticated read) — listing accounts is sensitive.
- `POST /users`, `PUT /users/:id` are admin-only. `POST /users/me/change-password` is open to any authenticated user (no `requireRole`).
- No `DELETE /users/:id` endpoint — deactivate via `status`, never delete.
- Any `PUT /users/:id` that would leave the system with zero active admins (demoting the last active admin's role, or deactivating them) is rejected with 400.
- Row objects returned from `execute()` have UPPERCASE keys — controllers and frontend types use `ROW.FIELD_NAME`, not `row.fieldName`.
- All SQL through `execute()` in `warehouse-server/src/db/dbUtils.ts` using named `:param` placeholders — never inline string-interpolated SQL.
- `PASSWORD_HASH` must never appear in any API response.

---

## Task 1: Last-active-admin guard (pure function, TDD)

**Files:**
- Create: `warehouse-server/src/utils/adminGuard.ts`
- Test: `warehouse-server/src/tests/adminGuard.test.ts`

**Interfaces:**
- Produces: `wouldRemoveLastAdmin(targetIsCurrentlyActiveAdmin: boolean, newRole: string | undefined, newStatus: string | undefined, otherActiveAdminCount: number): boolean` — consumed by Task 2's `updateUser`.

- [ ] **Step 1: Write the failing test — `warehouse-server/src/tests/adminGuard.test.ts`**

```typescript
/// <reference types="jest" />
import { wouldRemoveLastAdmin } from '../utils/adminGuard';

describe('wouldRemoveLastAdmin', () => {
    it('allows any change to a user who is not currently an active admin', () => {
        expect(wouldRemoveLastAdmin(false, 'staff', 'inactive', 0)).toBe(false);
    });

    it('allows a no-op update that keeps the user an active admin', () => {
        expect(wouldRemoveLastAdmin(true, undefined, undefined, 0)).toBe(false);
    });

    it('allows demoting the last active admin when another active admin exists', () => {
        expect(wouldRemoveLastAdmin(true, 'staff', undefined, 1)).toBe(false);
    });

    it('allows deactivating the last active admin when another active admin exists', () => {
        expect(wouldRemoveLastAdmin(true, undefined, 'inactive', 1)).toBe(false);
    });

    it('rejects demoting the sole active admin', () => {
        expect(wouldRemoveLastAdmin(true, 'staff', undefined, 0)).toBe(true);
    });

    it('rejects deactivating the sole active admin', () => {
        expect(wouldRemoveLastAdmin(true, undefined, 'inactive', 0)).toBe(true);
    });

    it('rejects both demoting and deactivating the sole active admin at once', () => {
        expect(wouldRemoveLastAdmin(true, 'staff', 'inactive', 0)).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd warehouse-server && npx jest adminGuard -v`
Expected: FAIL with "Cannot find module '../utils/adminGuard'"

- [ ] **Step 3: Create `warehouse-server/src/utils/adminGuard.ts`**

```typescript
export function wouldRemoveLastAdmin(
    targetIsCurrentlyActiveAdmin: boolean,
    newRole: string | undefined,
    newStatus: string | undefined,
    otherActiveAdminCount: number
): boolean {
    if (!targetIsCurrentlyActiveAdmin) return false;
    const staysAdmin = newRole === undefined || newRole === 'admin';
    const staysActive = newStatus === undefined || newStatus === 'active';
    if (staysAdmin && staysActive) return false;
    return otherActiveAdminCount === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd warehouse-server && npx jest adminGuard -v`
Expected: PASS, all 7 cases

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/utils/adminGuard.ts warehouse-server/src/tests/adminGuard.test.ts
git commit -m "feat(warehouse-server): add last-active-admin guard logic with TDD"
```

---

## Task 2: Backend — Users CRUD (list/detail/create/update)

**Files:**
- Create: `warehouse-server/src/schemas/userSchemas.ts`
- Create: `warehouse-server/src/controllers/userController.ts`
- Create: `warehouse-server/src/routes/userRoutes.ts`
- Modify: `warehouse-server/src/app.ts` (mount `/api/users`)
- Test: `warehouse-server/src/tests/users.test.ts`

**Interfaces:**
- Consumes: `execute` (`db/dbUtils.ts`), `hashPassword` (`utils/authUtils.ts`), `authenticateToken`/`requireRole` (`middleware/authMiddleware.ts`), `validateBody` (`middleware/validationMiddleware.ts`), `wouldRemoveLastAdmin` (Task 1).
- Produces: `GET /api/users` → array of `{ ID, USERNAME, NAME, ROLE, STATUS, CREATED_AT }` (never `PASSWORD_HASH`). `GET /api/users/:id` → single user, same shape. `POST /api/users`, `PUT /api/users/:id` (admin-only). `userSchemas.ts` also gains `changePasswordSchema` in Task 3 — this task creates the file with just `createUserSchema`/`updateUserSchema`.

- [ ] **Step 1: Create `warehouse-server/src/schemas/userSchemas.ts`**

```typescript
import { z } from 'zod';

export const createUserSchema = z.object({
    username: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    password: z.string().min(6).max(255),
    role: z.enum(['admin', 'staff']),
});

export const updateUserSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    role: z.enum(['admin', 'staff']).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    password: z.string().min(6).max(255).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });
```

- [ ] **Step 2: Create `warehouse-server/src/controllers/userController.ts`**

```typescript
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
```

- [ ] **Step 3: Create `warehouse-server/src/routes/userRoutes.ts`**

```typescript
import { Router } from 'express';
import { getUsers, getUserById, createUser, updateUser } from '../controllers/userController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { createUserSchema, updateUserSchema } from '../schemas/userSchemas';

const router = Router();

router.use(authenticateToken);

router.get('/', requireRole(['admin']), getUsers);
router.get('/:id', requireRole(['admin']), getUserById);
router.post('/', requireRole(['admin']), validateBody(createUserSchema), createUser);
router.put('/:id', requireRole(['admin']), validateBody(updateUserSchema), updateUser);

export default router;
```

- [ ] **Step 4: Modify `warehouse-server/src/app.ts` to mount user routes**

Add import alongside the other route imports:

```typescript
import userRoutes from './routes/userRoutes';
```

Add alongside the other `app.use('/api/...', ...)` lines (put it after `warehouseRoutes`):

```typescript
app.use('/api/users', userRoutes);
```

- [ ] **Step 5: Write the failing test — `warehouse-server/src/tests/users.test.ts`**

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
jest.mock('../utils/authUtils', () => ({
    hashPassword: jest.fn(async (pw: string) => `hashed:${pw}`),
    comparePassword: jest.fn(),
    generateToken: jest.fn(),
    verifyToken: jest.fn(),
}));

import userRoutes from '../routes/userRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd warehouse-server && npm test`
Expected: PASS, including all `Users API` cases, with no regressions in any other suite.

- [ ] **Step 7: Commit**

```bash
git add warehouse-server/src/schemas/userSchemas.ts warehouse-server/src/controllers/userController.ts warehouse-server/src/routes/userRoutes.ts warehouse-server/src/app.ts warehouse-server/src/tests/users.test.ts
git commit -m "feat(warehouse-server): add users CRUD API with last-active-admin guard"
```

---

## Task 3: Backend — self-service change-password endpoint

**Files:**
- Modify: `warehouse-server/src/schemas/userSchemas.ts` (add `changePasswordSchema`)
- Modify: `warehouse-server/src/controllers/userController.ts` (add `changeOwnPassword`)
- Modify: `warehouse-server/src/routes/userRoutes.ts` (add the route, no `requireRole`)
- Modify: `warehouse-server/src/tests/users.test.ts` (add tests + a `comparePassword` mock reference)

**Interfaces:**
- Consumes: `comparePassword`/`hashPassword` (`utils/authUtils.ts`).
- Produces: `POST /api/users/me/change-password` (any authenticated user) → `{ current_password, new_password }` → 200 on success, 401 on wrong current password. Reads the acting user's id from `req.user.id` (set by `authenticateToken`).

- [ ] **Step 1: Add `changePasswordSchema` to `warehouse-server/src/schemas/userSchemas.ts`**

Append to the end of the file:

```typescript

export const changePasswordSchema = z.object({
    current_password: z.string().min(1),
    new_password: z.string().min(6).max(255),
});
```

- [ ] **Step 2: Add `changeOwnPassword` to `warehouse-server/src/controllers/userController.ts`**

Add `comparePassword` to the existing import from `../utils/authUtils`:

```typescript
import { hashPassword, comparePassword } from '../utils/authUtils';
```

Append this export to the end of the file:

```typescript

export const changeOwnPassword = async (req: Request, res: Response) => {
    const { current_password, new_password } = req.body;
    const userId = (req as any).user?.id;
    try {
        const result = await execute<any>(`SELECT password_hash FROM users WHERE id = :id`, [userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        const isMatch = await comparePassword(current_password, result.rows[0].PASSWORD_HASH);
        if (!isMatch) {
            return res.status(401).json({ message: 'Current password is incorrect' });
        }
        const newHash = await hashPassword(new_password);
        await execute(`UPDATE users SET password_hash = :password_hash WHERE id = :id`, { password_hash: newHash, id: userId });
        res.json({ message: 'Password updated' });
    } catch (err) {
        console.error('changeOwnPassword error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
```

- [ ] **Step 3: Modify `warehouse-server/src/routes/userRoutes.ts`**

Change the import from:

```typescript
import { getUsers, getUserById, createUser, updateUser } from '../controllers/userController';
```

to:

```typescript
import { getUsers, getUserById, createUser, updateUser, changeOwnPassword } from '../controllers/userController';
```

Change the schema import from:

```typescript
import { createUserSchema, updateUserSchema } from '../schemas/userSchemas';
```

to:

```typescript
import { createUserSchema, updateUserSchema, changePasswordSchema } from '../schemas/userSchemas';
```

Add this route as the first route after `router.use(authenticateToken);` (before `router.get('/', ...)`), with no `requireRole`:

```typescript
router.post('/me/change-password', validateBody(changePasswordSchema), changeOwnPassword);
```

- [ ] **Step 4: Add tests to `warehouse-server/src/tests/users.test.ts`**

Add this import near the top of the file, alongside the existing `import { execute } from '../db/dbUtils';`:

```typescript
import { comparePassword } from '../utils/authUtils';

const mockComparePassword = comparePassword as jest.Mock;
```

Append this new `describe` block at the end of the file (after the `Users API — admin-only gating` block):

```typescript

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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd warehouse-server && npm test`
Expected: PASS across all suites, including the 3 new `change-password` cases.

- [ ] **Step 6: Commit**

```bash
git add warehouse-server/src/schemas/userSchemas.ts warehouse-server/src/controllers/userController.ts warehouse-server/src/routes/userRoutes.ts warehouse-server/src/tests/users.test.ts
git commit -m "feat(warehouse-server): add self-service change-password endpoint"
```

---

## Task 4: Frontend — types + Users page + route

**Files:**
- Modify: `warehouse-client/src/types.ts`
- Create: `warehouse-client/src/pages/Users.tsx`
- Modify: `warehouse-client/src/App.tsx` (add `/users` route)

**Interfaces:**
- Consumes: `api` (`services/api.ts`), `GET/POST/PUT /api/users` (Tasks 2-3), `useAuth` (`context/AuthContext.tsx`).
- Produces: `AppUser` type in `types.ts`. The page itself enforces an admin-only view (renders an access-denied message and skips the fetch for non-admins) — the nav item that links here is admin-gated separately in Task 5, but a non-admin could still navigate to `/users` directly by URL, and the backend already rejects them with 403; this in-page guard just avoids a broken-looking fetch failure in that case.

- [ ] **Step 1: Modify `warehouse-client/src/types.ts`**

Add this interface anywhere after `WhUser` (e.g. right after the `LoginResponse` interface):

```typescript
export interface AppUser {
    ID: number;
    USERNAME: string;
    NAME: string;
    ROLE: 'admin' | 'staff';
    STATUS: 'active' | 'inactive';
    CREATED_AT: string;
}
```

- [ ] **Step 2: Create `warehouse-client/src/pages/Users.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { AppUser } from '../types';

const Users: React.FC = () => {
    const { user } = useAuth();
    const isAdmin = user?.ROLE === 'admin';

    const [users, setUsers] = useState<AppUser[]>([]);
    const [loading, setLoading] = useState(isAdmin);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [username, setUsername] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<'admin' | 'staff'>('staff');

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editRole, setEditRole] = useState<'admin' | 'staff'>('staff');
    const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
    const [editPassword, setEditPassword] = useState('');

    const load = () => {
        setLoading(true);
        api.get<AppUser[]>('/users').then((res) => setUsers(res.data)).finally(() => setLoading(false));
    };

    useEffect(() => {
        if (isAdmin) load();
    }, [isAdmin]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/users', { username, name, password, role });
            toast.success('User created');
            setUsername('');
            setName('');
            setPassword('');
            setRole('staff');
            setShowCreateForm(false);
            load();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to create user');
        }
    };

    const startEdit = (u: AppUser) => {
        setEditingId(u.ID);
        setEditName(u.NAME);
        setEditRole(u.ROLE);
        setEditStatus(u.STATUS);
        setEditPassword('');
    };

    const cancelEdit = () => setEditingId(null);

    const saveEdit = async (id: number) => {
        try {
            await api.put(`/users/${id}`, {
                name: editName,
                role: editRole,
                status: editStatus,
                password: editPassword || undefined,
            });
            toast.success('User updated');
            setEditingId(null);
            load();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update user');
        }
    };

    if (!isAdmin) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Users</h1>
                <button
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
                >
                    {showCreateForm ? 'Cancel' : 'New User'}
                </button>
            </div>

            {showCreateForm && (
                <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-4 flex gap-3 items-end">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Username</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={username} onChange={(e) => setUsername(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
                        <input type="password" className="border border-slate-300 rounded-lg px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Role</label>
                        <select className="border border-slate-300 rounded-lg px-3 py-2" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'staff')}>
                            <option value="staff">Staff</option>
                            <option value="admin">Admin</option>
                        </select>
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
                            <th className="p-3">Username</th>
                            <th className="p-3">Name</th>
                            <th className="p-3">Role</th>
                            <th className="p-3">Status</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((u) =>
                            editingId === u.ID ? (
                                <tr key={u.ID} className="border-t border-slate-100 bg-slate-50">
                                    <td className="p-3">{u.USERNAME}</td>
                                    <td className="p-2">
                                        <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <select className="border border-slate-300 rounded px-2 py-1" value={editRole} onChange={(e) => setEditRole(e.target.value as 'admin' | 'staff')}>
                                            <option value="staff">Staff</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <select className="border border-slate-300 rounded px-2 py-1" value={editStatus} onChange={(e) => setEditStatus(e.target.value as 'active' | 'inactive')}>
                                            <option value="active">Active</option>
                                            <option value="inactive">Inactive</option>
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <div className="flex flex-col gap-2">
                                            <input type="password" placeholder="New password (optional)" className="border border-slate-300 rounded px-2 py-1 text-xs" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} minLength={6} />
                                            <div className="flex gap-2">
                                                <button onClick={() => saveEdit(u.ID)} className="text-green-600 hover:text-green-700 text-xs font-medium">Save</button>
                                                <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600 text-xs font-medium">Cancel</button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={u.ID} className="border-t border-slate-100">
                                    <td className="p-3">{u.USERNAME}</td>
                                    <td className="p-3">{u.NAME}</td>
                                    <td className="p-3 capitalize">{u.ROLE}</td>
                                    <td className="p-3 capitalize">{u.STATUS}</td>
                                    <td className="p-3">
                                        <button onClick={() => startEdit(u)} className="text-blue-600 hover:text-blue-700 text-xs font-medium">Edit</button>
                                    </td>
                                </tr>
                            )
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Users;
```

- [ ] **Step 3: Modify `warehouse-client/src/App.tsx` to add the route**

Add import:

```tsx
import Users from './pages/Users';
```

Add inside the `<Route path="/" element={...}>` block, alongside the other routes:

```tsx
<Route path="users" element={<Users />} />
```

- [ ] **Step 4: Verify the build**

Run: `cd warehouse-client && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add warehouse-client/src/types.ts warehouse-client/src/pages/Users.tsx warehouse-client/src/App.tsx
git commit -m "feat(warehouse-client): add users management page"
```

---

## Task 5: Frontend — Layout: admin-only Users nav item + Change Password modal

**Files:**
- Modify: `warehouse-client/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `POST /api/users/me/change-password` (Task 3), `useAuth` (existing).

- [ ] **Step 1: Replace `warehouse-client/src/components/Layout.tsx` with the following**

```tsx
import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { LayoutDashboard, Building2, Warehouse, PackageSearch, BarChart3, Users, LogOut, KeyRound } from 'lucide-react';

const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/companies', label: 'Companies', icon: Building2 },
    { to: '/warehouses', label: 'Warehouses', icon: Warehouse },
    { to: '/box-events', label: 'Box Events', icon: PackageSearch },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
];

const ADMIN_NAV_ITEMS = [
    { to: '/users', label: 'Users', icon: Users },
];

const Layout: React.FC = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const isAdmin = user?.ROLE === 'admin';
    const navItems = isAdmin ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS] : NAV_ITEMS;

    const [showChangePassword, setShowChangePassword] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/users/me/change-password', { current_password: currentPassword, new_password: newPassword });
            toast.success('Password changed');
            setCurrentPassword('');
            setNewPassword('');
            setShowChangePassword(false);
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to change password');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex h-screen bg-slate-50">
            <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
                <div className="p-4 border-b border-slate-200">
                    <h1 className="font-bold text-lg text-slate-800">DOK Warehouse</h1>
                </div>
                <nav className="flex-1 p-3 space-y-1">
                    {navItems.map(({ to, label, icon: Icon }) => (
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
                <div className="p-3 border-t border-slate-200 space-y-1">
                    <div className="text-sm text-slate-500 mb-2">{user?.NAME}</div>
                    <button
                        onClick={() => setShowChangePassword(true)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 w-full"
                    >
                        <KeyRound size={18} />
                        Change Password
                    </button>
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

            {showChangePassword && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                    <form onSubmit={handleChangePassword} className="bg-white rounded-xl border border-slate-200 p-6 w-80 space-y-3">
                        <h2 className="text-lg font-semibold text-slate-800">Change Password</h2>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Current Password</label>
                            <input type="password" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">New Password</label>
                            <input type="password" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setShowChangePassword(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                            <button type="submit" disabled={submitting} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                                {submitting ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Layout;
```

Note: this file imports `Users` (the lucide-react icon) — a different symbol from the `Users` page component in `pages/Users.tsx`; this file never imports that component, so there is no naming collision.

- [ ] **Step 2: Verify the build**

Run: `cd warehouse-client && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add warehouse-client/src/components/Layout.tsx
git commit -m "feat(warehouse-client): add admin-only Users nav item and change-password modal"
```

---

## Task 6: Manual end-to-end verification

**Files:** None (verification only).

- [ ] **Step 1: Start the stack**

With PostgreSQL reachable and `.env` configured:

```bash
cd warehouse-server && npm run dev
cd warehouse-client && npm run dev
```

- [ ] **Step 2: Walk the golden path**

1. Log in as `admin` / `password123`.
2. Go to Users (visible in nav) — create a new staff user, e.g. username `staff2`, password `password123`, role Staff.
3. Log out, log in as `staff2` — confirm the Users nav item is NOT visible, and confirm navigating directly to `/users` shows "You don't have access to this page." (not a broken/loading page).
4. As `staff2`, open Change Password (sidebar button), enter the wrong current password — confirm it's rejected with an error toast. Enter the correct current password and a new one — confirm success, log out, log back in with the new password to confirm it took effect.
5. Log back in as `admin`. Go to Users, edit `staff2` — change role to Admin, save; confirm it succeeds (there are now 2 active admins).
6. Edit the original `admin` account — try to set status to Inactive; confirm it succeeds now (since `staff2` is also an admin, this isn't the last one) — **then re-activate it again** so the environment isn't left with `admin` disabled.
7. Edit `staff2` back to role Staff, status Active (undo step 5, keep the environment clean for next time).
8. As a final guard check: with only `admin` remaining as the sole active admin, attempt to edit `admin`'s own role to Staff via the Users page — confirm it's rejected with an error toast containing "last active admin".

- [ ] **Step 3: Report results**

If everything in Step 2 passes, this task is complete — no commit (verification only). If anything fails, fix it under the relevant earlier task and re-verify.
