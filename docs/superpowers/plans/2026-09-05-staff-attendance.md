# Staff Master & Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-warehouse Staff Master records and daily Attendance marking (with an auto-computed monthly summary), replacing the manual process described in SRS FR-21/FR-22/FR-23 and UC-6 — the prerequisite for a later Payroll module.

**Architecture:** Two new tables (`staff`, `attendance`) behind a new `manage_staff` permission key, gated and warehouse-scoped exactly like Box Events and Warehouse Expenses (whole-router permission gate, `warehouseScope()` helper filtering by `warehouse_ids` for `warehouse_admin`, unscoped for `system_admin`). Daily attendance is a single bulk-upsert call across all of a warehouse's staff for one day, not one call per staff member.

**Tech Stack:** Same as the rest of `warehouse-server`/`warehouse-client` — Express 5 + TypeScript + `pg` + zod + Jest/supertest (backend), React 19 + TypeScript + TailwindCSS + `lucide-react` (frontend). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-05-staff-attendance-design.md](../specs/2026-09-05-staff-attendance-design.md)

## Global Constraints

- `manage_staff` covers BOTH Staff Master and Attendance — one permission key, not two. Granted by role default to `system_admin` and `warehouse_admin` only, not `finance_officer`.
- **This key must be added to EVERY location a permission key needs to exist, in one task, checked off explicitly** — this app's previous two modules each missed at least one of these locations, caught only at final whole-branch review: (1) `warehouse-server/src/utils/permissions.ts`'s `PermissionKey` type, `ALL_PERMISSION_KEYS`, and `ROLE_DEFAULTS`; (2) `warehouse-server/src/schemas/userSchemas.ts`'s `PERMISSION_KEY_VALUES` (a SEPARATE list from `permissions.ts` — do not assume updating one updates the other); (3) `warehouse-server/src/db/config.ts`'s `user_permission_overrides.permission_key` CHECK constraint (both the inline `CREATE TABLE` text and the `ALTER TABLE` widening pair); (4) `warehouse-client/src/types.ts`'s `PermissionKey` type; (5) `warehouse-client/src/pages/Users.tsx`'s `PERMISSION_LABELS` array (the UI list of grantable/revocable overrides). Missing any one of these means the permission either can't be represented, can't be validated, or can't be granted/revoked through the UI.
- Staff are deactivated (`status: 'active'|'inactive'`), never hard-deleted.
- Attendance is one row per staff member per day: `UNIQUE (staff_id, attendance_date)`, status one of `present`/`absent`/`half_day`/`leave`, optional `in_time`/`out_time`.
- Daily marking is `POST /attendance/bulk-mark`, one transaction, all-or-nothing: every `staff_id` in the batch must belong to the given `warehouse_id`, and that `warehouse_id` must be within the requester's own scope (for `warehouse_admin`) — reject the WHOLE batch (400) on any violation, never partially apply it.
- No audit-trail table, no "same month" correction lock in this module (both explicitly deferred per the spec).
- Warehouse-scoped frontend pickers MUST use the corrected pattern from this app's most recent module (`warehouse-client/src/pages/Expenses.tsx`'s `isScoped`/`selectableWarehouses` derivation, keyed off `user.ROLE === 'warehouse_admin'` and `user.WAREHOUSE_IDS`) — NOT the literal `user.ROLE === 'system_admin'` check used in an earlier, now-fixed version of that same file, which broke the feature for its primary user in any multi-warehouse deployment. Read `Expenses.tsx`'s current (fixed) state directly before writing `Staff.tsx`/`Attendance.tsx`.
- Row objects from `execute()` have UPPERCASE keys. All SQL through `execute()`/`withTransaction()` using named `:param` placeholders.

---

## Task 1: Data model — `staff` and `attendance` tables, widen `manage_staff` into the permission_key CHECK

**Files:**
- Modify: `warehouse-server/src/db/config.ts`

**Interfaces:**
- Produces: `staff` table, `attendance` table, widened `user_permission_overrides.permission_key` CHECK (now including `'manage_staff'`) — consumed by Tasks 2-4.

- [ ] **Step 1: Widen the `user_permission_overrides` permission_key CHECK constraint**

In `warehouse-server/src/db/config.ts`, the existing widening block (added by a prior module) currently reads:

```typescript
        await client.query(`
            ALTER TABLE user_permission_overrides DROP CONSTRAINT IF EXISTS user_permission_overrides_permission_key_check
        `);
        await client.query(`
            ALTER TABLE user_permission_overrides ADD CONSTRAINT user_permission_overrides_permission_key_check
                CHECK (permission_key IN (
                    'manage_companies', 'manage_warehouses', 'manage_box_events',
                    'view_invoices', 'manage_invoices', 'manage_users', 'manage_expenses'
                ))
        `);
```

Change the `ADD CONSTRAINT` list to include `'manage_staff'`:

```typescript
        await client.query(`
            ALTER TABLE user_permission_overrides DROP CONSTRAINT IF EXISTS user_permission_overrides_permission_key_check
        `);
        await client.query(`
            ALTER TABLE user_permission_overrides ADD CONSTRAINT user_permission_overrides_permission_key_check
                CHECK (permission_key IN (
                    'manage_companies', 'manage_warehouses', 'manage_box_events',
                    'view_invoices', 'manage_invoices', 'manage_users', 'manage_expenses', 'manage_staff'
                ))
        `);
```

Also update the inline CHECK in the `CREATE TABLE IF NOT EXISTS user_permission_overrides` block itself (for a genuinely fresh database) — find:

```typescript
                permission_key  VARCHAR(50) NOT NULL CHECK (permission_key IN (
                    'manage_companies', 'manage_warehouses', 'manage_box_events',
                    'view_invoices', 'manage_invoices', 'manage_users', 'manage_expenses'
                )),
```

and add `'manage_staff'` to that list too:

```typescript
                permission_key  VARCHAR(50) NOT NULL CHECK (permission_key IN (
                    'manage_companies', 'manage_warehouses', 'manage_box_events',
                    'view_invoices', 'manage_invoices', 'manage_users', 'manage_expenses', 'manage_staff'
                )),
```

Widening this constraint is safe in any order (it only adds an allowed value, never removes one — no data migration ordering concern, unlike the `users.role` migration earlier in this same file).

- [ ] **Step 2: Add the `staff` and `attendance` tables**

Immediately after the `warehouse_expenses` table's index (`idx_warehouse_expenses_date`) and before the `invoices` table, add:

```typescript
        await client.query(`
            CREATE TABLE IF NOT EXISTS staff (
                id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
                name          VARCHAR(200) NOT NULL,
                nic           VARCHAR(20) NOT NULL,
                designation   VARCHAR(100),
                join_date     DATE NOT NULL,
                basic_salary  NUMERIC(12,2) NOT NULL DEFAULT 0,
                epf_no        VARCHAR(50),
                status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
                created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS attendance (
                id                INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                staff_id          INTEGER NOT NULL REFERENCES staff(id),
                attendance_date   DATE NOT NULL,
                status            VARCHAR(20) NOT NULL CHECK (status IN ('present','absent','half_day','leave')),
                in_time           TIME,
                out_time          TIME,
                created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (staff_id, attendance_date)
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date)
        `);
```

`staff` must be created before `attendance` (FK dependency) — this ordering is already correct in the snippet above since `staff`'s `CREATE TABLE` statement appears first.

- [ ] **Step 3: Run the existing test suite to confirm no regressions**

Run: `cd warehouse-server && npm test`
Expected: all existing suites PASS (this task only adds new tables and widens a CHECK — no existing code path is touched).

- [ ] **Step 4: Boot against the real database to confirm the migration is safe**

Run the server (`cd warehouse-server && npm run dev`) against the actual `wh-postgres` container and confirm it boots without error, then verify directly:

```bash
docker exec wh-postgres psql -U dokwarehouse -d dok_warehouse -c "\d staff"
docker exec wh-postgres psql -U dokwarehouse -d dok_warehouse -c "\d attendance"
docker exec wh-postgres psql -U dokwarehouse -d dok_warehouse -c "\d user_permission_overrides"
```

Confirm `staff` and `attendance` exist with all their columns/constraints, and `user_permission_overrides`'s CHECK constraint now includes `manage_staff`. Restart the server a second time to confirm idempotency.

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/db/config.ts
git commit -m "feat(warehouse-server): add staff and attendance tables, widen permission_key CHECK for manage_staff"
```

---

## Task 2: `manage_staff` permission key — everywhere it needs to exist

**Files:**
- Modify: `warehouse-server/src/utils/permissions.ts`
- Modify: `warehouse-server/src/schemas/userSchemas.ts`
- Modify: `warehouse-server/src/tests/permissions.test.ts`

**Interfaces:**
- Produces: `PermissionKey` gains `'manage_staff'`; `ALL_PERMISSION_KEYS` and `PERMISSION_KEY_VALUES` both include it; `system_admin` and `warehouse_admin`'s role defaults both gain it. Consumed by Task 3/4's `requirePermission('manage_staff')` calls and Task 5's frontend work.

- [ ] **Step 1: Modify `warehouse-server/src/utils/permissions.ts`**

Change:

```typescript
export type PermissionKey =
    | 'manage_companies'
    | 'manage_warehouses'
    | 'manage_box_events'
    | 'view_invoices'
    | 'manage_invoices'
    | 'manage_users'
    | 'manage_expenses';

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
    'manage_companies',
    'manage_warehouses',
    'manage_box_events',
    'view_invoices',
    'manage_invoices',
    'manage_users',
    'manage_expenses',
];

const ROLE_DEFAULTS: Record<string, PermissionKey[]> = {
    system_admin: [
        'manage_companies', 'manage_warehouses', 'manage_box_events',
        'view_invoices', 'manage_invoices', 'manage_users', 'manage_expenses',
    ],
    warehouse_admin: ['manage_box_events', 'manage_expenses'],
    finance_officer: ['view_invoices', 'manage_invoices'],
};
```

to:

```typescript
export type PermissionKey =
    | 'manage_companies'
    | 'manage_warehouses'
    | 'manage_box_events'
    | 'view_invoices'
    | 'manage_invoices'
    | 'manage_users'
    | 'manage_expenses'
    | 'manage_staff';

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
    'manage_companies',
    'manage_warehouses',
    'manage_box_events',
    'view_invoices',
    'manage_invoices',
    'manage_users',
    'manage_expenses',
    'manage_staff',
];

const ROLE_DEFAULTS: Record<string, PermissionKey[]> = {
    system_admin: [
        'manage_companies', 'manage_warehouses', 'manage_box_events',
        'view_invoices', 'manage_invoices', 'manage_users', 'manage_expenses', 'manage_staff',
    ],
    warehouse_admin: ['manage_box_events', 'manage_expenses', 'manage_staff'],
    finance_officer: ['view_invoices', 'manage_invoices'],
};
```

- [ ] **Step 2: Modify `warehouse-server/src/schemas/userSchemas.ts`**

Change:

```typescript
export const PERMISSION_KEY_VALUES = [
    'manage_companies', 'manage_warehouses', 'manage_box_events',
    'view_invoices', 'manage_invoices', 'manage_users', 'manage_expenses',
] as const;
```

to:

```typescript
export const PERMISSION_KEY_VALUES = [
    'manage_companies', 'manage_warehouses', 'manage_box_events',
    'view_invoices', 'manage_invoices', 'manage_users', 'manage_expenses', 'manage_staff',
] as const;
```

This is a SEPARATE list from `permissions.ts` (it feeds the zod enum that gates every write to `user_permission_overrides`) — a prior module's final review found this exact list missed a key twice in a row. Do not skip this step.

- [ ] **Step 3: Modify `warehouse-server/src/tests/permissions.test.ts`**

Read the file first (it is short, reproduced here for exact context). Apply these changes:

1. The `system_admin` full-set test's expected array gains `'manage_staff'`:

```typescript
    it('returns the full permission set for system_admin with no overrides', () => {
        const result = computeEffectivePermissions('system_admin', []);
        expect(result.sort()).toEqual([
            'manage_box_events', 'manage_companies', 'manage_expenses', 'manage_invoices',
            'manage_staff', 'manage_users', 'manage_warehouses', 'view_invoices',
        ].sort());
    });
```

2. The `warehouse_admin` default-set test gains `'manage_staff'`:

```typescript
    it('returns manage_box_events, manage_expenses, and manage_staff for warehouse_admin with no overrides', () => {
        expect(computeEffectivePermissions('warehouse_admin', []).sort()).toEqual(['manage_box_events', 'manage_expenses', 'manage_staff'].sort());
    });
```

3. The "removes a permission via a revoke override" test (revokes `manage_box_events` from `warehouse_admin`) now leaves TWO permissions behind, not one:

```typescript
    it('removes a permission via a revoke override that is in the role default', () => {
        const result = computeEffectivePermissions('warehouse_admin', [{ permission_key: 'manage_box_events', granted: false }]);
        expect(result.sort()).toEqual(['manage_expenses', 'manage_staff'].sort());
    });
```

4. The "applies multiple overrides together" test (revokes `manage_box_events`, grants `view_invoices`) gains `manage_staff` in its expectation:

```typescript
    it('applies multiple overrides together', () => {
        const result = computeEffectivePermissions('warehouse_admin', [
            { permission_key: 'manage_box_events', granted: false },
            { permission_key: 'view_invoices', granted: true },
        ]);
        expect(result.sort()).toEqual(['manage_expenses', 'manage_staff', 'view_invoices'].sort());
    });
```

5. The "adds a permission via a grant override" test (grants `view_invoices` on top of `warehouse_admin`'s defaults) also needs `manage_staff` added:

```typescript
    it('adds a permission via a grant override not in the role default', () => {
        const result = computeEffectivePermissions('warehouse_admin', [{ permission_key: 'view_invoices', granted: true }]);
        expect(result.sort()).toEqual(['manage_box_events', 'manage_expenses', 'manage_staff', 'view_invoices'].sort());
    });
```

The `finance_officer` test and the "unrecognized role" test are unaffected — leave them as-is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd warehouse-server && npx jest permissions --verbose`
Expected: PASS, all 7 cases

- [ ] **Step 5: Run the full suite to confirm no other regressions**

Run: `cd warehouse-server && npm test`
Expected: all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add warehouse-server/src/utils/permissions.ts warehouse-server/src/schemas/userSchemas.ts warehouse-server/src/tests/permissions.test.ts
git commit -m "feat(warehouse-server): add manage_staff permission key to system_admin and warehouse_admin defaults"
```

---

## Task 3: Staff CRUD — schema, controller, routes

**Files:**
- Create: `warehouse-server/src/schemas/staffSchemas.ts`
- Create: `warehouse-server/src/controllers/staffController.ts`
- Create: `warehouse-server/src/routes/staffRoutes.ts`
- Modify: `warehouse-server/src/app.ts`
- Test: `warehouse-server/src/tests/staff.test.ts`

**Interfaces:**
- Consumes: `requirePermission` (`middleware/permissionMiddleware.ts`), `validateBody`/`validateQuery` (`middleware/validationMiddleware.ts`), `execute` (`db/dbUtils.ts`).
- Produces: `getStaff`, `createStaff`, `updateStaff` in `staffController.ts`, plus an exported `warehouseScope(req)` helper (returns `null` for any role except `warehouse_admin`, else `req.user.warehouse_ids || []` — matching this app's established pattern in `boxEventController.ts`/`expenseController.ts`). `GET/POST /staff`, `PUT /staff/:id` mounted at `/api/staff`. Consumed by Task 4 (Attendance needs to validate a `staff_id` belongs to a given `warehouse_id`) and Task 6 (frontend).

- [ ] **Step 1: Create `warehouse-server/src/schemas/staffSchemas.ts`**

```typescript
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');

export const createStaffSchema = z.object({
    warehouse_id: z.number().int().positive(),
    name: z.string().min(1).max(200),
    nic: z.string().min(1).max(20),
    designation: z.string().max(100).optional(),
    join_date: dateStr,
    basic_salary: z.number().min(0).optional(),
    epf_no: z.string().max(50).optional(),
});

export const updateStaffSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    nic: z.string().min(1).max(20).optional(),
    designation: z.string().max(100).optional(),
    join_date: dateStr.optional(),
    basic_salary: z.number().min(0).optional(),
    epf_no: z.string().max(50).optional(),
    status: z.enum(['active', 'inactive']).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });

export const staffQuerySchema = z.object({
    warehouse_id: z.string().regex(/^\d+$/, 'warehouse_id must be numeric').optional(),
    status: z.enum(['active', 'inactive']).optional(),
});
```

- [ ] **Step 2: Create `warehouse-server/src/controllers/staffController.ts`**

```typescript
import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export function warehouseScope(req: Request): number[] | null {
    const user = (req as any).user;
    if (!user || user.role !== 'warehouse_admin') return null;
    return user.warehouse_ids || [];
}

export const getStaff = async (req: Request, res: Response) => {
    const { warehouse_id, status } = req.query;
    const scope = warehouseScope(req);
    try {
        let query = `
            SELECT s.*, w.name AS warehouse_name
            FROM staff s
            JOIN warehouses w ON w.id = s.warehouse_id
            WHERE 1=1
        `;
        const params: any = {};
        if (warehouse_id) { query += ` AND s.warehouse_id = :warehouse_id`; params.warehouse_id = warehouse_id; }
        if (status) { query += ` AND s.status = :status`; params.status = status; }
        if (scope !== null) { query += ` AND s.warehouse_id = ANY(:warehouse_ids)`; params.warehouse_ids = scope; }
        query += ` ORDER BY s.name`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getStaff error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createStaff = async (req: Request, res: Response) => {
    const { warehouse_id, name, nic, designation, join_date, basic_salary, epf_no } = req.body;
    const scope = warehouseScope(req);

    if (scope !== null && !scope.includes(warehouse_id)) {
        return res.status(400).json({ message: 'warehouse_id is outside your assigned warehouses' });
    }

    try {
        const result = await execute<any>(
            `INSERT INTO staff (warehouse_id, name, nic, designation, join_date, basic_salary, epf_no)
             VALUES (:warehouse_id, :name, :nic, :designation, :join_date, :basic_salary, :epf_no)
             RETURNING *`,
            {
                warehouse_id, name, nic,
                designation: designation || null,
                join_date,
                basic_salary: basic_salary ?? 0,
                epf_no: epf_no || null,
            }
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createStaff error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateStaff = async (req: Request, res: Response) => {
    const { id } = req.params;
    const fields = req.body;
    const scope = warehouseScope(req);

    try {
        let existingQuery = `SELECT id FROM staff WHERE id = :id`;
        const existingParams: any = { id };
        if (scope !== null) {
            existingQuery += ` AND warehouse_id = ANY(:warehouse_ids)`;
            existingParams.warehouse_ids = scope;
        }
        const existingResult = await execute<any>(existingQuery, existingParams);
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ message: 'Staff member not found' });
        }

        const setClauses = Object.keys(fields).map(key => `${key} = :${key}`).join(', ');
        const result = await execute<any>(
            `UPDATE staff SET ${setClauses} WHERE id = :id RETURNING *`,
            { ...fields, id }
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateStaff error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
```

- [ ] **Step 3: Create `warehouse-server/src/routes/staffRoutes.ts`**

```typescript
import { Router } from 'express';
import { getStaff, createStaff, updateStaff } from '../controllers/staffController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { createStaffSchema, updateStaffSchema, staffQuerySchema } from '../schemas/staffSchemas';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('manage_staff'));

router.get('/', validateQuery(staffQuerySchema), getStaff);
router.post('/', validateBody(createStaffSchema), createStaff);
router.put('/:id', validateBody(updateStaffSchema), updateStaff);

export default router;
```

- [ ] **Step 4: Wire the router into `warehouse-server/src/app.ts`**

Read the file first. Add the import alongside the other route imports:

```typescript
import staffRoutes from './routes/staffRoutes';
```

Add the mount alongside the other `app.use('/api/...', ...)` lines:

```typescript
app.use('/api/staff', staffRoutes);
```

- [ ] **Step 5: Write the test suite — `warehouse-server/src/tests/staff.test.ts`**

```typescript
/// <reference types="jest" />
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../middleware/authMiddleware', () => ({
    authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = { id: 1, role: 'system_admin' };
        next();
    },
}));

jest.mock('../middleware/permissionMiddleware', () => ({
    requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../db/dbUtils', () => ({ execute: jest.fn() }));

import staffRoutes from '../routes/staffRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/staff', staffRoutes);

const VALID_BODY = { warehouse_id: 1, name: 'Kamal Perera', nic: '901234567V', join_date: '2020-01-15' };

describe('POST /api/staff', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('creates a staff member, defaulting basic_salary to 0', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, WAREHOUSE_ID: 1, NAME: 'Kamal Perera', NIC: '901234567V', BASIC_SALARY: 0 }] });

        const res = await request(app).post('/api/staff').send(VALID_BODY);

        expect(res.status).toBe(201);
        const [, params] = mockExecute.mock.calls[0];
        expect(params).toMatchObject({ warehouse_id: 1, name: 'Kamal Perera', nic: '901234567V', basic_salary: 0 });
    });

    it('rejects a body missing required fields', async () => {
        const res = await request(app).post('/api/staff').send({ warehouse_id: 1, name: 'Kamal' });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('GET /api/staff', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('filters by warehouse_id and status', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/staff?warehouse_id=1&status=active');

        expect(res.status).toBe(200);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND s\.warehouse_id = :warehouse_id/);
        expect(query).toMatch(/AND s\.status = :status/);
        expect(params).toMatchObject({ warehouse_id: '1', status: 'active' });
    });
});

describe('PUT /api/staff/:id', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('deactivates a staff member', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] })
            .mockResolvedValueOnce({ rows: [{ ID: 1, STATUS: 'inactive' }] });

        const res = await request(app).put('/api/staff/1').send({ status: 'inactive' });

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[1][0]).toMatch(/UPDATE staff SET status = :status/);
    });

    it('returns 404 when the staff member does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).put('/api/staff/999').send({ status: 'inactive' });

        expect(res.status).toBe(404);
    });
});

describe('POST /api/staff — warehouse scoping for warehouse_admin', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('rejects creating a staff member for a warehouse outside the warehouse_admin\'s warehouse_ids', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 9, role: 'warehouse_admin', warehouse_ids: [2] };
                next();
            },
        }));
        jest.doMock('../middleware/permissionMiddleware', () => ({
            requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../db/dbUtils', () => ({ execute: jest.fn() }));

        const scopedRoutes = require('../routes/staffRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/staff', scopedRoutes);

        const res = await request(scopedApp).post('/api/staff').send({ ...VALID_BODY, warehouse_id: 1 });

        expect(res.status).toBe(400);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});

describe('GET /api/staff — warehouse scoping for warehouse_admin', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('scopes results to the warehouse_admin\'s warehouse_ids', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 9, role: 'warehouse_admin', warehouse_ids: [2] };
                next();
            },
        }));
        jest.doMock('../middleware/permissionMiddleware', () => ({
            requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../db/dbUtils', () => {
            const execute = jest.fn();
            execute.mockResolvedValueOnce({ rows: [] });
            return { execute };
        });

        const scopedRoutes = require('../routes/staffRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/staff', scopedRoutes);

        const res = await request(scopedApp).get('/api/staff');

        expect(res.status).toBe(200);
        const { execute: scopedExecute } = require('../db/dbUtils');
        const [query, params] = scopedExecute.mock.calls[0];
        expect(query).toMatch(/AND s\.warehouse_id = ANY\(:warehouse_ids\)/);
        expect(params.warehouse_ids).toEqual([2]);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd warehouse-server && npx jest staff --verbose`
Expected: PASS, all 7 cases

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `cd warehouse-server && npm test`
Expected: all suites PASS.

- [ ] **Step 8: Commit**

```bash
git add warehouse-server/src/schemas/staffSchemas.ts warehouse-server/src/controllers/staffController.ts warehouse-server/src/routes/staffRoutes.ts warehouse-server/src/app.ts warehouse-server/src/tests/staff.test.ts
git commit -m "feat(warehouse-server): add staff CRUD (create/list/update) with warehouse scoping"
```

---

## Task 4: Attendance — bulk-mark, list, monthly summary

**Files:**
- Create: `warehouse-server/src/schemas/attendanceSchemas.ts`
- Create: `warehouse-server/src/controllers/attendanceController.ts`
- Create: `warehouse-server/src/routes/attendanceRoutes.ts`
- Modify: `warehouse-server/src/app.ts`
- Test: `warehouse-server/src/tests/attendance.test.ts`

**Interfaces:**
- Consumes: `requirePermission`, `validateBody`/`validateQuery`, `execute`/`withTransaction` (`db/dbUtils.ts`). Duplicates its own local `warehouseScope(req)` helper (matching this app's established per-controller-file convention — see `boxEventController.ts`/`expenseController.ts`/`staffController.ts`, each of which has its own copy rather than importing a shared one).
- Produces: `bulkMarkAttendance`, `getAttendance`, `getAttendanceSummary` in `attendanceController.ts`. `POST /attendance/bulk-mark`, `GET /attendance`, `GET /attendance/summary` mounted at `/api/attendance`. Consumed by Task 7 (frontend) and a future Payroll module (the summary endpoint's `counts` shape).

- [ ] **Step 1: Create `warehouse-server/src/schemas/attendanceSchemas.ts`**

```typescript
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');
const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Must be HH:MM format').optional();

const attendanceEntrySchema = z.object({
    staff_id: z.number().int().positive(),
    status: z.enum(['present', 'absent', 'half_day', 'leave']),
    in_time: timeStr,
    out_time: timeStr,
});

export const bulkMarkSchema = z.object({
    warehouse_id: z.number().int().positive(),
    attendance_date: dateStr,
    entries: z.array(attendanceEntrySchema).min(1),
});

export const attendanceQuerySchema = z.object({
    staff_id: z.string().regex(/^\d+$/, 'staff_id must be numeric').optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
});

export const attendanceSummaryQuerySchema = z.object({
    staff_id: z.string().regex(/^\d+$/, 'staff_id must be numeric'),
    year: z.string().regex(/^\d{4}$/, 'year must be a 4-digit number'),
    month: z.string().regex(/^(0?[1-9]|1[0-2])$/, 'month must be 1-12'),
});
```

- [ ] **Step 2: Create `warehouse-server/src/controllers/attendanceController.ts`**

```typescript
import { Request, Response } from 'express';
import { execute, withTransaction } from '../db/dbUtils';

function warehouseScope(req: Request): number[] | null {
    const user = (req as any).user;
    if (!user || user.role !== 'warehouse_admin') return null;
    return user.warehouse_ids || [];
}

export const bulkMarkAttendance = async (req: Request, res: Response) => {
    const { warehouse_id, attendance_date, entries } = req.body;
    const scope = warehouseScope(req);

    if (scope !== null && !scope.includes(warehouse_id)) {
        return res.status(400).json({ message: 'warehouse_id is outside your assigned warehouses' });
    }

    try {
        const saved = await withTransaction(async (exec) => {
            const staffIds = entries.map((e: any) => e.staff_id);
            const staffResult = await exec<any>(
                `SELECT id FROM staff WHERE id = ANY(:staff_ids) AND warehouse_id = :warehouse_id`,
                { staff_ids: staffIds, warehouse_id }
            );
            if (staffResult.rows.length !== staffIds.length) {
                throw Object.assign(
                    new Error('One or more staff_id values do not belong to warehouse_id'),
                    { statusCode: 400 }
                );
            }

            const results = [];
            for (const entry of entries) {
                const upsertResult = await exec<any>(
                    `INSERT INTO attendance (staff_id, attendance_date, status, in_time, out_time)
                     VALUES (:staff_id, :attendance_date, :status, :in_time, :out_time)
                     ON CONFLICT (staff_id, attendance_date)
                     DO UPDATE SET status = :status, in_time = :in_time, out_time = :out_time, updated_at = now()
                     RETURNING *`,
                    {
                        staff_id: entry.staff_id,
                        attendance_date,
                        status: entry.status,
                        in_time: entry.in_time || null,
                        out_time: entry.out_time || null,
                    }
                );
                results.push(upsertResult.rows[0]);
            }
            return results;
        });

        res.status(200).json(saved);
    } catch (err: any) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ message: err.message });
        }
        console.error('bulkMarkAttendance error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getAttendance = async (req: Request, res: Response) => {
    const { staff_id, from, to } = req.query;
    const scope = warehouseScope(req);
    try {
        let query = `
            SELECT a.*, s.name AS staff_name, s.warehouse_id
            FROM attendance a
            JOIN staff s ON s.id = a.staff_id
            WHERE 1=1
        `;
        const params: any = {};
        if (staff_id) { query += ` AND a.staff_id = :staff_id`; params.staff_id = staff_id; }
        if (from) { query += ` AND a.attendance_date >= :from`; params.from = from; }
        if (to) { query += ` AND a.attendance_date <= :to`; params.to = to; }
        if (scope !== null) { query += ` AND s.warehouse_id = ANY(:warehouse_ids)`; params.warehouse_ids = scope; }
        query += ` ORDER BY a.attendance_date DESC, s.name`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getAttendance error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getAttendanceSummary = async (req: Request, res: Response) => {
    const { staff_id, year, month } = req.query as { staff_id: string; year: string; month: string };
    const scope = warehouseScope(req);
    try {
        let staffQuery = `SELECT id FROM staff WHERE id = :staff_id`;
        const staffParams: any = { staff_id };
        if (scope !== null) {
            staffQuery += ` AND warehouse_id = ANY(:warehouse_ids)`;
            staffParams.warehouse_ids = scope;
        }
        const staffResult = await execute<any>(staffQuery, staffParams);
        if (staffResult.rows.length === 0) {
            return res.status(404).json({ message: 'Staff member not found' });
        }

        const result = await execute<any>(
            `SELECT status, COUNT(*)::int AS count
             FROM attendance
             WHERE staff_id = :staff_id
               AND date_trunc('month', attendance_date) = make_date(:year::int, :month::int, 1)
             GROUP BY status`,
            { staff_id, year: Number(year), month: Number(month) }
        );

        const counts: Record<string, number> = { present: 0, absent: 0, half_day: 0, leave: 0 };
        for (const row of result.rows) {
            counts[row.STATUS] = row.COUNT;
        }

        res.json({ staff_id: Number(staff_id), year: Number(year), month: Number(month), counts });
    } catch (err) {
        console.error('getAttendanceSummary error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
```

- [ ] **Step 3: Create `warehouse-server/src/routes/attendanceRoutes.ts`**

```typescript
import { Router } from 'express';
import { bulkMarkAttendance, getAttendance, getAttendanceSummary } from '../controllers/attendanceController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { bulkMarkSchema, attendanceQuerySchema, attendanceSummaryQuerySchema } from '../schemas/attendanceSchemas';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('manage_staff'));

router.get('/summary', validateQuery(attendanceSummaryQuerySchema), getAttendanceSummary);
router.get('/', validateQuery(attendanceQuerySchema), getAttendance);
router.post('/bulk-mark', validateBody(bulkMarkSchema), bulkMarkAttendance);

export default router;
```

- [ ] **Step 4: Wire the router into `warehouse-server/src/app.ts`**

Add the import and mount, alongside the ones Task 3 already added:

```typescript
import attendanceRoutes from './routes/attendanceRoutes';
```

```typescript
app.use('/api/attendance', attendanceRoutes);
```

- [ ] **Step 5: Write the test suite — `warehouse-server/src/tests/attendance.test.ts`**

```typescript
/// <reference types="jest" />
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../middleware/authMiddleware', () => ({
    authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = { id: 1, role: 'system_admin' };
        next();
    },
}));

jest.mock('../middleware/permissionMiddleware', () => ({
    requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../db/dbUtils', () => {
    const execute = jest.fn();
    return {
        execute,
        withTransaction: jest.fn(async (fn: any) => fn(execute)),
    };
});

import attendanceRoutes from '../routes/attendanceRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/attendance', attendanceRoutes);

const VALID_BODY = {
    warehouse_id: 1,
    attendance_date: '2026-09-05',
    entries: [
        { staff_id: 1, status: 'present', in_time: '08:00', out_time: '17:00' },
        { staff_id: 2, status: 'absent' },
    ],
};

describe('POST /api/attendance/bulk-mark', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('upserts every entry in one transaction when all staff belong to warehouse_id', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }, { ID: 2 }] }) // staff existence check
            .mockResolvedValueOnce({ rows: [{ ID: 10, STAFF_ID: 1, STATUS: 'present' }] }) // upsert 1
            .mockResolvedValueOnce({ rows: [{ ID: 11, STAFF_ID: 2, STATUS: 'absent' }] }); // upsert 2

        const res = await request(app).post('/api/attendance/bulk-mark').send(VALID_BODY);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(mockExecute.mock.calls[1][0]).toMatch(/INSERT INTO attendance/);
        expect(mockExecute.mock.calls[1][0]).toMatch(/ON CONFLICT \(staff_id, attendance_date\)/);
    });

    it('rejects the whole batch when one staff_id does not belong to warehouse_id', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1 }] }); // only 1 of 2 staff_ids matched

        const res = await request(app).post('/api/attendance/bulk-mark').send(VALID_BODY);

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/do not belong to warehouse_id/);
        // Only the existence check ran — no INSERT/upsert attempted for any entry
        expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid status value', async () => {
        const res = await request(app).post('/api/attendance/bulk-mark').send({
            ...VALID_BODY,
            entries: [{ staff_id: 1, status: 'on_vacation' }],
        });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('GET /api/attendance', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('filters by staff_id and date range', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/attendance?staff_id=1&from=2026-09-01&to=2026-09-30');

        expect(res.status).toBe(200);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND a\.staff_id = :staff_id/);
        expect(query).toMatch(/AND a\.attendance_date >= :from/);
        expect(query).toMatch(/AND a\.attendance_date <= :to/);
        expect(params).toMatchObject({ staff_id: '1', from: '2026-09-01', to: '2026-09-30' });
    });
});

describe('GET /api/attendance/summary', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('computes per-status counts for the given month', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // staff existence check
            .mockResolvedValueOnce({ rows: [
                { STATUS: 'present', COUNT: 20 },
                { STATUS: 'absent', COUNT: 2 },
                { STATUS: 'leave', COUNT: 1 },
            ] });

        const res = await request(app).get('/api/attendance/summary?staff_id=1&year=2026&month=9');

        expect(res.status).toBe(200);
        expect(res.body.counts).toEqual({ present: 20, absent: 2, half_day: 0, leave: 1 });
    });

    it('returns 404 when the staff member does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/attendance/summary?staff_id=999&year=2026&month=9');

        expect(res.status).toBe(404);
    });
});

describe('POST /api/attendance/bulk-mark — warehouse scoping for warehouse_admin', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('rejects a warehouse_id outside the warehouse_admin\'s warehouse_ids before touching the database', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 9, role: 'warehouse_admin', warehouse_ids: [2] };
                next();
            },
        }));
        jest.doMock('../middleware/permissionMiddleware', () => ({
            requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../db/dbUtils', () => {
            const execute = jest.fn();
            return { execute, withTransaction: jest.fn(async (fn: any) => fn(execute)) };
        });

        const scopedRoutes = require('../routes/attendanceRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/attendance', scopedRoutes);

        const res = await request(scopedApp).post('/api/attendance/bulk-mark').send({ ...VALID_BODY, warehouse_id: 1 });

        expect(res.status).toBe(400);
        const { execute: scopedExecute } = require('../db/dbUtils');
        expect(scopedExecute).not.toHaveBeenCalled();

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd warehouse-server && npx jest attendance --verbose`
Expected: PASS, all cases (3 bulk-mark + 1 list + 2 summary + 1 scoping = 7)

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `cd warehouse-server && npm test`
Expected: all suites PASS.

- [ ] **Step 8: Commit**

```bash
git add warehouse-server/src/schemas/attendanceSchemas.ts warehouse-server/src/controllers/attendanceController.ts warehouse-server/src/routes/attendanceRoutes.ts warehouse-server/src/app.ts warehouse-server/src/tests/attendance.test.ts
git commit -m "feat(warehouse-server): add attendance bulk-mark, list, and monthly summary endpoints"
```

---

## Task 5: Frontend — permission key, types, navigation, and the Users override list

**Files:**
- Modify: `warehouse-client/src/types.ts`
- Modify: `warehouse-client/src/components/Layout.tsx`
- Modify: `warehouse-client/src/pages/Users.tsx`
- Modify: `warehouse-client/src/App.tsx`

**Interfaces:**
- Produces: `Staff`, `AttendanceEntry`, `AttendanceSummary` types; `PermissionKey` gains `'manage_staff'`; `Layout.tsx` gains "Staff" and "Attendance" nav items gated on `manage_staff`; `Users.tsx`'s `PERMISSION_LABELS` gains `manage_staff` (this app's previous module missed this exact step — see Global Constraints). Consumed by Tasks 6/7.

- [ ] **Step 1: Modify `warehouse-client/src/types.ts`**

Change:

```typescript
export type PermissionKey =
    | 'manage_companies'
    | 'manage_warehouses'
    | 'manage_box_events'
    | 'view_invoices'
    | 'manage_invoices'
    | 'manage_users'
    | 'manage_expenses';
```

to:

```typescript
export type PermissionKey =
    | 'manage_companies'
    | 'manage_warehouses'
    | 'manage_box_events'
    | 'view_invoices'
    | 'manage_invoices'
    | 'manage_users'
    | 'manage_expenses'
    | 'manage_staff';
```

Append these new interfaces at the end of the file:

```typescript
export interface Staff {
    ID: number;
    WAREHOUSE_ID: number;
    WAREHOUSE_NAME?: string;
    NAME: string;
    NIC: string;
    DESIGNATION: string | null;
    JOIN_DATE: string;
    BASIC_SALARY: number;
    EPF_NO: string | null;
    STATUS: 'active' | 'inactive';
    CREATED_AT: string;
}

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave';

export interface AttendanceEntry {
    ID: number;
    STAFF_ID: number;
    STAFF_NAME?: string;
    WAREHOUSE_ID?: number;
    ATTENDANCE_DATE: string;
    STATUS: AttendanceStatus;
    IN_TIME: string | null;
    OUT_TIME: string | null;
}

export interface AttendanceSummary {
    staff_id: number;
    year: number;
    month: number;
    counts: {
        present: number;
        absent: number;
        half_day: number;
        leave: number;
    };
}
```

- [ ] **Step 2: Modify `warehouse-client/src/components/Layout.tsx`**

Read the file first. Add `Contact`/`ClipboardCheck` (or similarly available `lucide-react` icons) to the import — use `Contact` for Staff and `ClipboardCheck` for Attendance:

```typescript
import { LayoutDashboard, Building2, Warehouse, PackageSearch, BarChart3, Users, Receipt, Wallet, Contact, ClipboardCheck, LogOut, KeyRound } from 'lucide-react';
```

Add "Staff" and "Attendance" to the `navItems` array, both gated on `manage_staff`:

```typescript
    const navItems = [
        ...NAV_ITEMS,
        ...(permissions.includes('manage_expenses') ? [{ to: '/expenses', label: 'Expenses', icon: Wallet }] : []),
        ...(permissions.includes('manage_staff') ? [{ to: '/staff', label: 'Staff', icon: Contact }] : []),
        ...(permissions.includes('manage_staff') ? [{ to: '/attendance', label: 'Attendance', icon: ClipboardCheck }] : []),
        ...(permissions.includes('manage_users') ? [{ to: '/users', label: 'Users', icon: Users }] : []),
        ...(permissions.includes('view_invoices') ? [{ to: '/invoices', label: 'Invoices', icon: Receipt }] : []),
    ];
```

- [ ] **Step 3: Modify `warehouse-client/src/pages/Users.tsx`**

Find `PERMISSION_LABELS` (it lists the existing seven permission keys with human-readable labels). Add an entry for the new key:

```typescript
    { key: 'manage_staff', label: 'Manage Staff' },
```

- [ ] **Step 4: Modify `warehouse-client/src/App.tsx`**

Add the two new route imports alongside the existing page imports:

```typescript
import Staff from './pages/Staff';
import Attendance from './pages/Attendance';
```

Add the two routes alongside the existing ones inside the authenticated `<Layout />` route:

```tsx
                    <Route path="staff" element={<Staff />} />
                    <Route path="attendance" element={<Attendance />} />
```

(`Staff.tsx`/`Attendance.tsx` don't exist yet — Tasks 6/7 create them. This is an intentional, temporary compile break, exactly like this app's previous module sequenced its own type-then-usage split across tasks.)

- [ ] **Step 5: Verify the build fails only on the two missing modules**

Run: `cd warehouse-client && npm run build`
Expected: fails with "Cannot find module './pages/Staff'" and "Cannot find module './pages/Attendance'" (or equivalent) — no other error.

- [ ] **Step 6: Commit**

```bash
git add warehouse-client/src/types.ts warehouse-client/src/components/Layout.tsx warehouse-client/src/pages/Users.tsx warehouse-client/src/App.tsx
git commit -m "feat(warehouse-client): add manage_staff permission key, Staff/Attendance types, and nav items"
```

---

## Task 6: Frontend — Staff page

**Files:**
- Create: `warehouse-client/src/pages/Staff.tsx`

**Interfaces:**
- Consumes: `Staff`, `Warehouse` types (Task 5/existing), `GET/POST /staff`, `PUT /staff/:id` (Task 3), `useAuth()`.
- Produces: the `Staff` page component, resolving one of Task 5's two dangling imports.

- [ ] **Step 1: Read the current (fixed) state of `warehouse-client/src/pages/Expenses.tsx` in full**

This file was the subject of a Critical bug fix in this app's most recent module — its warehouse-picker logic was originally (incorrectly) keyed off a literal `user.ROLE === 'system_admin'` check, which broke the feature for any `warehouse_admin` in a multi-warehouse deployment. It now uses a corrected `isScoped`/`selectableWarehouses` pattern. Read its CURRENT content before writing this task's code, so you copy the corrected pattern, not the broken one.

- [ ] **Step 2: Create `warehouse-client/src/pages/Staff.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Check, X } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Warehouse, Staff as StaffMember } from '../types';

function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

const Staff: React.FC = () => {
    const { user } = useAuth();
    const canManageStaff = user?.EFFECTIVE_PERMISSIONS?.includes('manage_staff') ?? false;
    const isScoped = user?.ROLE === 'warehouse_admin';
    const selectableWarehouseIds = user?.WAREHOUSE_IDS ?? [];

    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const selectableWarehouses = isScoped
        ? warehouses.filter((w) => selectableWarehouseIds.includes(w.ID))
        : warehouses;
    const [staffList, setStaffList] = useState<StaffMember[]>([]);
    const [loading, setLoading] = useState(canManageStaff);

    const [showCreateForm, setShowCreateForm] = useState(false);
    const [formWarehouseId, setFormWarehouseId] = useState('');
    const [name, setName] = useState('');
    const [nic, setNic] = useState('');
    const [designation, setDesignation] = useState('');
    const [joinDate, setJoinDate] = useState(todayISO());
    const [basicSalary, setBasicSalary] = useState('');
    const [epfNo, setEpfNo] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editDesignation, setEditDesignation] = useState('');
    const [editBasicSalary, setEditBasicSalary] = useState('');
    const [editEpfNo, setEditEpfNo] = useState('');
    const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');

    const loadStaff = () => {
        api.get<StaffMember[]>('/staff').then((res) => setStaffList(res.data));
    };

    useEffect(() => {
        if (!canManageStaff) return;
        Promise.all([
            api.get<Warehouse[]>('/warehouses'),
            api.get<StaffMember[]>('/staff'),
        ]).then(([warehousesRes, staffRes]) => {
            setWarehouses(warehousesRes.data);
            setStaffList(staffRes.data);
            if (isScoped) {
                const ownWarehouses = warehousesRes.data.filter((w) => selectableWarehouseIds.includes(w.ID));
                if (ownWarehouses.length === 1) {
                    setFormWarehouseId(String(ownWarehouses[0].ID));
                }
            }
        }).finally(() => setLoading(false));
    }, [canManageStaff, isScoped]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/staff', {
                warehouse_id: Number(formWarehouseId),
                name, nic,
                designation: designation || undefined,
                join_date: joinDate,
                basic_salary: basicSalary ? Number(basicSalary) : undefined,
                epf_no: epfNo || undefined,
            });
            toast.success('Staff member added');
            setName(''); setNic(''); setDesignation(''); setBasicSalary(''); setEpfNo('');
            setShowCreateForm(false);
            loadStaff();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to add staff member');
        } finally {
            setSubmitting(false);
        }
    };

    const startEdit = (s: StaffMember) => {
        setEditingId(s.ID);
        setEditName(s.NAME);
        setEditDesignation(s.DESIGNATION || '');
        setEditBasicSalary(String(s.BASIC_SALARY));
        setEditEpfNo(s.EPF_NO || '');
        setEditStatus(s.STATUS);
    };

    const cancelEdit = () => setEditingId(null);

    const saveEdit = async (id: number) => {
        try {
            await api.put(`/staff/${id}`, {
                name: editName,
                designation: editDesignation || undefined,
                basic_salary: editBasicSalary ? Number(editBasicSalary) : undefined,
                epf_no: editEpfNo || undefined,
                status: editStatus,
            });
            toast.success('Staff member updated');
            setEditingId(null);
            loadStaff();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update staff member');
        }
    };

    if (!canManageStaff) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Staff</h1>
                <button
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700"
                >
                    {showCreateForm ? 'Cancel' : 'New Staff Member'}
                </button>
            </div>

            {showCreateForm && (
                <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
                    {selectableWarehouses.length > 1 && (
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Warehouse</label>
                            <select className="border border-slate-300 rounded-lg px-3 py-2" value={formWarehouseId} onChange={(e) => setFormWarehouseId(e.target.value)} required>
                                <option value="">Select...</option>
                                {selectableWarehouses.map((w) => (
                                    <option key={w.ID} value={w.ID}>{w.NAME}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">NIC</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={nic} onChange={(e) => setNic(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Designation</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={designation} onChange={(e) => setDesignation(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Join Date</label>
                        <input type="date" className="border border-slate-300 rounded-lg px-3 py-2" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Basic Salary</label>
                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded-lg px-3 py-2 w-32" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">EPF No.</label>
                        <input className="border border-slate-300 rounded-lg px-3 py-2" value={epfNo} onChange={(e) => setEpfNo(e.target.value)} />
                    </div>
                    <button type="submit" disabled={submitting || !formWarehouseId} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {submitting ? 'Saving...' : 'Save'}
                    </button>
                </form>
            )}

            <div className="bg-white rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Name</th>
                            <th className="p-3">NIC</th>
                            {!isScoped && <th className="p-3">Warehouse</th>}
                            <th className="p-3">Designation</th>
                            <th className="p-3">Join Date</th>
                            <th className="p-3">Basic Salary</th>
                            <th className="p-3">EPF No.</th>
                            <th className="p-3">Status</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {staffList.map((s) =>
                            editingId === s.ID ? (
                                <tr key={s.ID} className="border-t border-slate-100 bg-slate-50">
                                    <td className="p-2">
                                        <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                                    </td>
                                    <td className="p-3">{s.NIC}</td>
                                    {!isScoped && <td className="p-3">{s.WAREHOUSE_NAME}</td>}
                                    <td className="p-2">
                                        <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editDesignation} onChange={(e) => setEditDesignation(e.target.value)} />
                                    </td>
                                    <td className="p-3">{s.JOIN_DATE}</td>
                                    <td className="p-2">
                                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editBasicSalary} onChange={(e) => setEditBasicSalary(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editEpfNo} onChange={(e) => setEditEpfNo(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <select className="border border-slate-300 rounded px-2 py-1" value={editStatus} onChange={(e) => setEditStatus(e.target.value as 'active' | 'inactive')}>
                                            <option value="active">Active</option>
                                            <option value="inactive">Inactive</option>
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <div className="flex gap-2">
                                            <button onClick={() => saveEdit(s.ID)} className="text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                                            <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={s.ID} className="border-t border-slate-100">
                                    <td className="p-3">{s.NAME}</td>
                                    <td className="p-3">{s.NIC}</td>
                                    {!isScoped && <td className="p-3">{s.WAREHOUSE_NAME}</td>}
                                    <td className="p-3">{s.DESIGNATION}</td>
                                    <td className="p-3">{s.JOIN_DATE}</td>
                                    <td className="p-3">{s.BASIC_SALARY.toFixed(2)}</td>
                                    <td className="p-3">{s.EPF_NO}</td>
                                    <td className="p-3 capitalize">{s.STATUS}</td>
                                    <td className="p-3">
                                        <button onClick={() => startEdit(s)} className="text-slate-500 hover:text-blue-600" title="Edit"><Pencil size={16} /></button>
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

export default Staff;
```

- [ ] **Step 3: Verify the build**

Run: `cd warehouse-client && npm run build`
Expected: fails ONLY with "Cannot find module './pages/Attendance'" — the `Staff` import is now resolved.

- [ ] **Step 4: Commit**

```bash
git add warehouse-client/src/pages/Staff.tsx
git commit -m "feat(warehouse-client): add Staff page with warehouse-scoped CRUD"
```

---

## Task 7: Frontend — Attendance page

**Files:**
- Create: `warehouse-client/src/pages/Attendance.tsx`

**Interfaces:**
- Consumes: `Staff`, `AttendanceEntry`, `AttendanceStatus`, `AttendanceSummary`, `Warehouse` types (Task 5), `GET /staff` (Task 3), `POST /attendance/bulk-mark`, `GET /attendance/summary` (Task 4), `useAuth()`.
- Produces: the `Attendance` page component, resolving Task 5's second dangling import — this is the last file with a known compile break in this plan.

- [ ] **Step 1: Create `warehouse-client/src/pages/Attendance.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Warehouse, Staff, AttendanceStatus, AttendanceSummary } from '../types';

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
    { value: 'present', label: 'Present' },
    { value: 'absent', label: 'Absent' },
    { value: 'half_day', label: 'Half-Day' },
    { value: 'leave', label: 'Leave' },
];

function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

interface RowState {
    status: AttendanceStatus;
    in_time: string;
    out_time: string;
}

const Attendance: React.FC = () => {
    const { user } = useAuth();
    const canManageStaff = user?.EFFECTIVE_PERMISSIONS?.includes('manage_staff') ?? false;
    const isScoped = user?.ROLE === 'warehouse_admin';
    const selectableWarehouseIds = user?.WAREHOUSE_IDS ?? [];

    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const selectableWarehouses = isScoped
        ? warehouses.filter((w) => selectableWarehouseIds.includes(w.ID))
        : warehouses;
    const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
    const [attendanceDate, setAttendanceDate] = useState(todayISO());

    const [staffList, setStaffList] = useState<Staff[]>([]);
    const [rows, setRows] = useState<Record<number, RowState>>({});
    const [loading, setLoading] = useState(canManageStaff);
    const [saving, setSaving] = useState(false);

    const [summaryStaffId, setSummaryStaffId] = useState('');
    const [summaryYear, setSummaryYear] = useState(new Date().getFullYear());
    const [summaryMonth, setSummaryMonth] = useState(new Date().getMonth() + 1);
    const [summary, setSummary] = useState<AttendanceSummary | null>(null);

    useEffect(() => {
        if (!canManageStaff) return;
        api.get<Warehouse[]>('/warehouses').then((res) => {
            setWarehouses(res.data);
            if (isScoped) {
                const ownWarehouses = res.data.filter((w) => selectableWarehouseIds.includes(w.ID));
                if (ownWarehouses.length === 1) {
                    setSelectedWarehouseId(String(ownWarehouses[0].ID));
                }
            }
        }).finally(() => setLoading(false));
    }, [canManageStaff, isScoped]);

    useEffect(() => {
        if (!selectedWarehouseId) {
            setStaffList([]);
            return;
        }
        api.get<Staff[]>('/staff', { params: { warehouse_id: selectedWarehouseId, status: 'active' } })
            .then((res) => {
                setStaffList(res.data);
                const initial: Record<number, RowState> = {};
                for (const s of res.data) {
                    initial[s.ID] = { status: 'present', in_time: '', out_time: '' };
                }
                setRows(initial);
            });
    }, [selectedWarehouseId]);

    const updateRow = (staffId: number, field: keyof RowState, value: string) => {
        setRows((prev) => ({ ...prev, [staffId]: { ...prev[staffId], [field]: value } }));
    };

    const handleSaveDay = async () => {
        setSaving(true);
        try {
            const entries = staffList.map((s) => {
                const row = rows[s.ID];
                const entry: any = { staff_id: s.ID, status: row.status };
                if (row.in_time) entry.in_time = row.in_time;
                if (row.out_time) entry.out_time = row.out_time;
                return entry;
            });
            await api.post('/attendance/bulk-mark', {
                warehouse_id: Number(selectedWarehouseId),
                attendance_date: attendanceDate,
                entries,
            });
            toast.success('Attendance saved');
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to save attendance');
        } finally {
            setSaving(false);
        }
    };

    const loadSummary = () => {
        if (!summaryStaffId) return;
        api.get<AttendanceSummary>('/attendance/summary', { params: { staff_id: summaryStaffId, year: summaryYear, month: summaryMonth } })
            .then((res) => setSummary(res.data));
    };

    useEffect(() => {
        loadSummary();
    }, [summaryStaffId, summaryYear, summaryMonth]);

    if (!canManageStaff) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Attendance</h1>

            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    {selectableWarehouses.length > 1 && (
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Warehouse</label>
                            <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={selectedWarehouseId} onChange={(e) => setSelectedWarehouseId(e.target.value)}>
                                <option value="">Select...</option>
                                {selectableWarehouses.map((w) => (
                                    <option key={w.ID} value={w.ID}>{w.NAME}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
                        <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
                    </div>
                </div>

                {staffList.length > 0 && (
                    <table className="w-full text-sm">
                        <thead className="text-left text-slate-500">
                            <tr>
                                <th className="p-2">Staff</th>
                                <th className="p-2">Status</th>
                                <th className="p-2">In Time</th>
                                <th className="p-2">Out Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {staffList.map((s) => (
                                <tr key={s.ID} className="border-t border-slate-100">
                                    <td className="p-2">{s.NAME}</td>
                                    <td className="p-2">
                                        <select
                                            className="border border-slate-300 rounded px-2 py-1"
                                            value={rows[s.ID]?.status || 'present'}
                                            onChange={(e) => updateRow(s.ID, 'status', e.target.value)}
                                        >
                                            {STATUS_OPTIONS.map((opt) => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        {(rows[s.ID]?.status === 'present' || rows[s.ID]?.status === 'half_day') && (
                                            <input type="time" className="border border-slate-300 rounded px-2 py-1" value={rows[s.ID]?.in_time || ''} onChange={(e) => updateRow(s.ID, 'in_time', e.target.value)} />
                                        )}
                                    </td>
                                    <td className="p-2">
                                        {(rows[s.ID]?.status === 'present' || rows[s.ID]?.status === 'half_day') && (
                                            <input type="time" className="border border-slate-300 rounded px-2 py-1" value={rows[s.ID]?.out_time || ''} onChange={(e) => updateRow(s.ID, 'out_time', e.target.value)} />
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {staffList.length > 0 && (
                    <button onClick={handleSaveDay} disabled={saving} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {saving ? 'Saving...' : 'Save Day'}
                    </button>
                )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-slate-700">Monthly Summary</h2>
                    <div className="flex gap-2">
                        <select className="border border-slate-300 rounded px-2 py-1 text-sm" value={summaryStaffId} onChange={(e) => setSummaryStaffId(e.target.value)}>
                            <option value="">Select staff...</option>
                            {staffList.map((s) => (
                                <option key={s.ID} value={s.ID}>{s.NAME}</option>
                            ))}
                        </select>
                        <select className="border border-slate-300 rounded px-2 py-1 text-sm" value={summaryMonth} onChange={(e) => setSummaryMonth(Number(e.target.value))}>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                        <input type="number" className="border border-slate-300 rounded px-2 py-1 text-sm w-20" value={summaryYear} onChange={(e) => setSummaryYear(Number(e.target.value))} />
                    </div>
                </div>
                {summary && (
                    <div className="grid grid-cols-4 gap-3 text-sm">
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <div className="text-slate-500">Present</div>
                            <div className="text-lg font-semibold">{summary.counts.present}</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <div className="text-slate-500">Absent</div>
                            <div className="text-lg font-semibold">{summary.counts.absent}</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <div className="text-slate-500">Half-Day</div>
                            <div className="text-lg font-semibold">{summary.counts.half_day}</div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-3 text-center">
                            <div className="text-slate-500">Leave</div>
                            <div className="text-lg font-semibold">{summary.counts.leave}</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Attendance;
```

- [ ] **Step 2: Verify the build succeeds**

Run: `cd warehouse-client && npm run build`
Expected: succeeds with ZERO TypeScript errors — this was the last file with a known compile break in this plan.

- [ ] **Step 3: Commit**

```bash
git add warehouse-client/src/pages/Attendance.tsx
git commit -m "feat(warehouse-client): add Attendance page with bulk daily marking and monthly summary"
```

---

## Task 8: Manual end-to-end verification

**Files:** None (verification only).

- [ ] **Step 1: Start the stack**

```bash
cd warehouse-server && npm run dev
cd warehouse-client && npm run dev
```

Confirm the server boots cleanly against the real `wh-postgres` database (the `staff`/`attendance` tables and widened `manage_staff` permission already exist from Task 1's live verification).

- [ ] **Step 2: Golden path as `system_admin`**

1. Log in as `system_admin`. Confirm "Staff" and "Attendance" appear in the nav.
2. On the Staff page, create 2-3 staff members for one warehouse.
3. On the Attendance page, select that warehouse and today's date, mark each staff member Present/Absent/Half-Day/Leave (with in/out times for Present/Half-Day), and Save Day.
4. Reload and re-select the same warehouse+date — confirm the daily marking screen shows the just-saved statuses are queryable via `GET /attendance` (the UI itself doesn't pre-fill the marking grid in this module — that's acceptable per the spec's scope; verify via a direct API call that the data persisted correctly).
5. Use the Monthly Summary panel to confirm the day's marks are reflected in that staff member's count for the current month.
6. Deactivate one staff member via the Staff page's status toggle; confirm they no longer appear in the Attendance page's marking list for a NEW day (re-select the warehouse+a different date).

- [ ] **Step 3: Log in as a `warehouse_admin`**

1. Confirm "Staff"/"Attendance" appear in nav, with no warehouse picker (their own warehouse used automatically) — this specifically re-verifies Task 6/7's Global-Constraints-mandated use of the corrected `isScoped` pattern, not the broken `isSystemAdmin` one from the prior module.
2. Confirm they only see their own warehouse's staff (create a staff member as `system_admin` for a DIFFERENT warehouse first, to have something to correctly exclude).
3. Mark and save a full day's attendance for their own warehouse's staff — confirm it succeeds.
4. Attempt (via direct API call) `POST /api/staff` and `POST /api/attendance/bulk-mark` with a `warehouse_id` outside their scope — confirm both 400.

- [ ] **Step 4: Log in as a `finance_officer`**

1. Confirm "Staff"/"Attendance" do NOT appear in the nav (no default `manage_staff`).
2. Confirm every `/api/staff*` and `/api/attendance*` route returns 403 for this role.

- [ ] **Step 5: Report results**

If everything in Steps 2-4 passes, this task is complete — no commit (verification only). If anything fails, fix it under the relevant earlier task and re-verify.
