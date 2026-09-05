# Warehouse Expense Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual "Warehouse Daily Expenses" Excel workbooks with a digital daily-expense entry screen per warehouse, an auto-generated monthly summary with month-over-month variance, and a cross-warehouse comparison view for the System Administrator (SRS FR-18/FR-19/FR-20, UC-5).

**Architecture:** A new `warehouse_expenses` table (one row per warehouse per day, 5 fixed category-amount columns) behind a new `manage_expenses` permission key, gated and warehouse-scoped exactly like the existing Box Events module (whole-router permission gate, `warehouseScope()` filtering for `warehouse_admin`, unscoped for `system_admin`). Two additional read endpoints compute monthly summaries (with per-category variance) and cross-warehouse comparisons.

**Tech Stack:** Same as the rest of `warehouse-server`/`warehouse-client` — Express 5 + TypeScript + `pg` + zod + Jest/supertest (backend), React 19 + TypeScript + TailwindCSS + `lucide-react` (frontend). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-05-warehouse-expense-tracking-design.md](../specs/2026-09-05-warehouse-expense-tracking-design.md)

## Global Constraints

- Five fixed expense categories, one column each: `transport_amount`, `fuel_amount`, `labour_amount`, `meals_amount`, `other_amount`. One shared `remarks` field per day (not per category).
- `UNIQUE (warehouse_id, expense_date)` — exactly one entry per warehouse per calendar day. `POST` creates (409 on duplicate), `PUT` edits an existing entry. No immutability lock — entries stay correctable indefinitely.
- New permission key `manage_expenses`, added to `PermissionKey`/`ALL_PERMISSION_KEYS` and granted by role default to `system_admin` and `warehouse_admin` only (not `finance_officer`).
- The entire expenses router (including `GET`) requires `manage_expenses`, mirroring `boxEventRoutes.ts` exactly — there is no open-read tier for this resource.
- Warehouse scoping via the same `warehouseScope(req)` helper pattern used in `boxEventController.ts`/`companyController.ts`: returns `null` for any role except `warehouse_admin`, in which case it returns `(req as any).user.warehouse_ids || []`.
- Variance is computed per category, not just a grand total: `value = current - prior`, `percent = (value / prior) * 100`; both `null` when the prior month has no entries at all (distinguishing "no baseline" from "spent nothing").
- No historical Excel import in this module.
- Row objects from `execute()` have UPPERCASE keys. All SQL through `execute()` using named `:param` placeholders.

---

## Task 1: `computeVariance` pure function (TDD)

**Files:**
- Create: `warehouse-server/src/utils/expenseVariance.ts`
- Test: `warehouse-server/src/tests/expenseVariance.test.ts`

**Interfaces:**
- Produces: `computeVariance(current: number | null, prior: number | null): { value: number | null, percent: number | null }` — consumed by Task 5's summary endpoint.

- [ ] **Step 1: Write the failing test — `warehouse-server/src/tests/expenseVariance.test.ts`**

```typescript
/// <reference types="jest" />
import { computeVariance } from '../utils/expenseVariance';

describe('computeVariance', () => {
    it('computes value and percent when both current and prior are present', () => {
        expect(computeVariance(150, 100)).toEqual({ value: 50, percent: 50 });
    });

    it('computes a negative variance when current is lower than prior', () => {
        expect(computeVariance(80, 100)).toEqual({ value: -20, percent: -20 });
    });

    it('returns null value and null percent when prior is null (no baseline)', () => {
        expect(computeVariance(150, null)).toEqual({ value: null, percent: null });
    });

    it('returns null value and null percent when current is null', () => {
        expect(computeVariance(null, 100)).toEqual({ value: null, percent: null });
    });

    it('returns a value but null percent when prior is zero (division by zero guarded)', () => {
        expect(computeVariance(50, 0)).toEqual({ value: 50, percent: null });
    });

    it('returns value 0 and null percent when both current and prior are zero', () => {
        expect(computeVariance(0, 0)).toEqual({ value: 0, percent: null });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd warehouse-server && npx jest expenseVariance --verbose`
Expected: FAIL with "Cannot find module '../utils/expenseVariance'"

- [ ] **Step 3: Create `warehouse-server/src/utils/expenseVariance.ts`**

```typescript
export interface Variance {
    value: number | null;
    percent: number | null;
}

export function computeVariance(current: number | null, prior: number | null): Variance {
    if (current === null || prior === null) {
        return { value: null, percent: null };
    }
    const value = current - prior;
    if (prior === 0) {
        return { value, percent: null };
    }
    return { value, percent: (value / prior) * 100 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd warehouse-server && npx jest expenseVariance --verbose`
Expected: PASS, all 6 cases

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/utils/expenseVariance.ts warehouse-server/src/tests/expenseVariance.test.ts
git commit -m "feat(warehouse-server): add expense variance calculation with TDD"
```

---

## Task 2: Data model — `warehouse_expenses` table

**Files:**
- Modify: `warehouse-server/src/db/config.ts`

**Interfaces:**
- Produces: `warehouse_expenses` table — consumed by Tasks 4 and 5. Widened `user_permission_overrides.permission_key` CHECK constraint — consumed by Task 3.

- [ ] **Step 1: Widen the `user_permission_overrides` permission_key CHECK constraint**

In `warehouse-server/src/db/config.ts`, immediately after the existing `CREATE TABLE IF NOT EXISTS user_permission_overrides (...)` block, add:

```typescript
        // Widen the permission_key CHECK to include manage_expenses. Safe to
        // run in any order relative to existing rows — this only ADDS an
        // allowed value, it never removes one, so no pre-existing row can
        // violate it (unlike the users.role migration above, which had to
        // migrate data before tightening).
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

Also update the inline CHECK in the `CREATE TABLE IF NOT EXISTS user_permission_overrides` block itself (for a genuinely fresh database), changing:

```typescript
                permission_key  VARCHAR(50) NOT NULL CHECK (permission_key IN (
                    'manage_companies', 'manage_warehouses', 'manage_box_events',
                    'view_invoices', 'manage_invoices', 'manage_users'
                )),
```

to:

```typescript
                permission_key  VARCHAR(50) NOT NULL CHECK (permission_key IN (
                    'manage_companies', 'manage_warehouses', 'manage_box_events',
                    'view_invoices', 'manage_invoices', 'manage_users', 'manage_expenses'
                )),
```

- [ ] **Step 2: Add the `warehouse_expenses` table**

Immediately after the `box_events` indexes block (`idx_box_events_date`) and before the `invoices` table, add:

```typescript
        await client.query(`
            CREATE TABLE IF NOT EXISTS warehouse_expenses (
                id                 INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                warehouse_id       INTEGER NOT NULL REFERENCES warehouses(id),
                expense_date       DATE NOT NULL,
                transport_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
                fuel_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
                labour_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
                meals_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
                other_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
                remarks            TEXT,
                created_by         INTEGER REFERENCES users(id),
                created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (warehouse_id, expense_date)
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_warehouse_expenses_date ON warehouse_expenses(expense_date)
        `);
```

- [ ] **Step 3: Run the existing test suite to confirm no regressions**

Run: `cd warehouse-server && npm test`
Expected: all existing suites still PASS (this task only adds a new table and widens a CHECK — no existing code path is touched).

- [ ] **Step 4: Boot against the real database to confirm the migration is safe**

Run the server (`cd warehouse-server && npm run dev`) against the actual `wh-postgres` container and confirm it boots without error, then verify directly:

```bash
docker exec wh-postgres psql -U dokwarehouse -d dok_warehouse -c "\d warehouse_expenses"
docker exec wh-postgres psql -U dokwarehouse -d dok_warehouse -c "\d user_permission_overrides"
```

Confirm `warehouse_expenses` exists with all 12 columns and the unique constraint, and `user_permission_overrides`'s CHECK constraint now includes `manage_expenses`. Restart the server a second time to confirm idempotency (no errors on a second boot against the now-migrated database).

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/db/config.ts
git commit -m "feat(warehouse-server): add warehouse_expenses table and widen permission_key CHECK for manage_expenses"
```

---

## Task 3: `manage_expenses` permission key

**Files:**
- Modify: `warehouse-server/src/utils/permissions.ts`
- Modify: `warehouse-server/src/tests/permissions.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PermissionKey` gains `'manage_expenses'`; `ALL_PERMISSION_KEYS` includes it; `system_admin` and `warehouse_admin`'s role defaults both gain it. Consumed by Task 4/5's `requirePermission('manage_expenses')` calls and the frontend's `EFFECTIVE_PERMISSIONS` checks.

- [ ] **Step 1: Modify `warehouse-server/src/utils/permissions.ts`**

Change:

```typescript
export type PermissionKey =
    | 'manage_companies'
    | 'manage_warehouses'
    | 'manage_box_events'
    | 'view_invoices'
    | 'manage_invoices'
    | 'manage_users';

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
    'manage_companies',
    'manage_warehouses',
    'manage_box_events',
    'view_invoices',
    'manage_invoices',
    'manage_users',
];

const ROLE_DEFAULTS: Record<string, PermissionKey[]> = {
    system_admin: [
        'manage_companies', 'manage_warehouses', 'manage_box_events',
        'view_invoices', 'manage_invoices', 'manage_users',
    ],
    warehouse_admin: ['manage_box_events'],
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

- [ ] **Step 2: Modify `warehouse-server/src/tests/permissions.test.ts`**

Read the file first (it is short, reproduced here for exact context). Apply these changes:

1. The `system_admin` full-set test's expected array gains `'manage_expenses'`:

```typescript
    it('returns the full permission set for system_admin with no overrides', () => {
        const result = computeEffectivePermissions('system_admin', []);
        expect(result.sort()).toEqual([
            'manage_box_events', 'manage_companies', 'manage_expenses', 'manage_invoices',
            'manage_users', 'manage_warehouses', 'view_invoices',
        ].sort());
    });
```

2. The `warehouse_admin` default-set test gains `'manage_expenses'`:

```typescript
    it('returns manage_box_events and manage_expenses for warehouse_admin with no overrides', () => {
        expect(computeEffectivePermissions('warehouse_admin', []).sort()).toEqual(['manage_box_events', 'manage_expenses'].sort());
    });
```

3. The "removes a permission via a revoke override" test previously expected an empty array after revoking `manage_box_events` from `warehouse_admin` — since `warehouse_admin` now also has `manage_expenses` by default, revoking only `manage_box_events` leaves `manage_expenses` behind:

```typescript
    it('removes a permission via a revoke override that is in the role default', () => {
        const result = computeEffectivePermissions('warehouse_admin', [{ permission_key: 'manage_box_events', granted: false }]);
        expect(result).toEqual(['manage_expenses']);
    });
```

4. The "applies multiple overrides together" test also revokes `manage_box_events` — update its expectation the same way:

```typescript
    it('applies multiple overrides together', () => {
        const result = computeEffectivePermissions('warehouse_admin', [
            { permission_key: 'manage_box_events', granted: false },
            { permission_key: 'view_invoices', granted: true },
        ]);
        expect(result.sort()).toEqual(['manage_expenses', 'view_invoices'].sort());
    });
```

5. The "adds a permission via a grant override" test (grants `view_invoices` on top of the `warehouse_admin` default) also needs its expectation widened to include `manage_expenses`:

```typescript
    it('adds a permission via a grant override not in the role default', () => {
        const result = computeEffectivePermissions('warehouse_admin', [{ permission_key: 'view_invoices', granted: true }]);
        expect(result.sort()).toEqual(['manage_box_events', 'manage_expenses', 'view_invoices'].sort());
    });
```

The `finance_officer` test and the "unrecognized role" test are unaffected — leave them as-is.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd warehouse-server && npx jest permissions --verbose`
Expected: PASS, all 7 cases

- [ ] **Step 4: Run the full suite to confirm no other regressions**

Run: `cd warehouse-server && npm test`
Expected: all suites PASS. (`permissionMiddleware.test.ts` is unaffected — its `warehouse_admin` tests exercise `manage_users`/`view_invoices`, neither of which changed.)

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/utils/permissions.ts warehouse-server/src/tests/permissions.test.ts
git commit -m "feat(warehouse-server): add manage_expenses permission key to system_admin and warehouse_admin defaults"
```

---

## Task 4: Expense CRUD — schema, controller, routes

**Files:**
- Create: `warehouse-server/src/schemas/expenseSchemas.ts`
- Create: `warehouse-server/src/controllers/expenseController.ts`
- Create: `warehouse-server/src/routes/expenseRoutes.ts`
- Modify: `warehouse-server/src/app.ts`
- Test: `warehouse-server/src/tests/expenses.test.ts`

**Interfaces:**
- Consumes: `requirePermission` (`middleware/permissionMiddleware.ts`), `validateBody`/`validateQuery` (`middleware/validationMiddleware.ts`), `execute` (`db/dbUtils.ts`).
- Produces: `createExpense`, `getExpenses`, `updateExpense`, `deleteExpense` in `expenseController.ts`; `POST/GET /expenses`, `PUT/DELETE /expenses/:id` mounted at `/api/expenses`. Consumed by Task 5 (adds two more routes to the same router/controller) and Task 7 (frontend).

- [ ] **Step 1: Create `warehouse-server/src/schemas/expenseSchemas.ts`**

```typescript
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');
const amount = z.number().min(0);

export const createExpenseSchema = z.object({
    warehouse_id: z.number().int().positive(),
    expense_date: dateStr,
    transport_amount: amount.optional(),
    fuel_amount: amount.optional(),
    labour_amount: amount.optional(),
    meals_amount: amount.optional(),
    other_amount: amount.optional(),
    remarks: z.string().optional(),
});

export const updateExpenseSchema = z.object({
    transport_amount: amount.optional(),
    fuel_amount: amount.optional(),
    labour_amount: amount.optional(),
    meals_amount: amount.optional(),
    other_amount: amount.optional(),
    remarks: z.string().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });

export const expenseQuerySchema = z.object({
    warehouse_id: z.string().optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
});
```

- [ ] **Step 2: Create `warehouse-server/src/controllers/expenseController.ts`**

```typescript
import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export function warehouseScope(req: Request): number[] | null {
    const user = (req as any).user;
    if (!user || user.role !== 'warehouse_admin') return null;
    return user.warehouse_ids || [];
}

const AMOUNT_FIELDS = ['transport_amount', 'fuel_amount', 'labour_amount', 'meals_amount', 'other_amount'] as const;

export const createExpense = async (req: Request, res: Response) => {
    const { warehouse_id, expense_date, remarks, ...amounts } = req.body;
    const userId = (req as any).user?.id ?? null;
    const scope = warehouseScope(req);

    if (scope !== null && !scope.includes(warehouse_id)) {
        return res.status(400).json({ message: 'warehouse_id is outside your assigned warehouses' });
    }

    try {
        const fields: any = { warehouse_id, expense_date, remarks: remarks || null, created_by: userId };
        for (const key of AMOUNT_FIELDS) {
            fields[key] = amounts[key] ?? 0;
        }

        const result = await execute<any>(
            `INSERT INTO warehouse_expenses
                (warehouse_id, expense_date, transport_amount, fuel_amount, labour_amount, meals_amount, other_amount, remarks, created_by)
             VALUES
                (:warehouse_id, :expense_date, :transport_amount, :fuel_amount, :labour_amount, :meals_amount, :other_amount, :remarks, :created_by)
             RETURNING *`,
            fields
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'An expense entry already exists for this warehouse and date' });
        }
        console.error('createExpense error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getExpenses = async (req: Request, res: Response) => {
    const { warehouse_id, from, to } = req.query;
    const scope = warehouseScope(req);
    try {
        let query = `
            SELECT we.*, w.name AS warehouse_name
            FROM warehouse_expenses we
            JOIN warehouses w ON w.id = we.warehouse_id
            WHERE 1=1
        `;
        const params: any = {};
        if (warehouse_id) { query += ` AND we.warehouse_id = :warehouse_id`; params.warehouse_id = warehouse_id; }
        if (from) { query += ` AND we.expense_date >= :from`; params.from = from; }
        if (to) { query += ` AND we.expense_date <= :to`; params.to = to; }
        if (scope !== null) { query += ` AND we.warehouse_id = ANY(:warehouse_ids)`; params.warehouse_ids = scope; }
        query += ` ORDER BY we.expense_date DESC, we.id DESC LIMIT 500`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getExpenses error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const updateExpense = async (req: Request, res: Response) => {
    const { id } = req.params;
    const fields = req.body;
    const scope = warehouseScope(req);

    try {
        let existingQuery = `SELECT id FROM warehouse_expenses WHERE id = :id`;
        const existingParams: any = { id };
        if (scope !== null) {
            existingQuery += ` AND warehouse_id = ANY(:warehouse_ids)`;
            existingParams.warehouse_ids = scope;
        }
        const existingResult = await execute<any>(existingQuery, existingParams);
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ message: 'Expense entry not found' });
        }

        const setClauses = Object.keys(fields).map(key => `${key} = :${key}`).join(', ');
        const result = await execute<any>(
            `UPDATE warehouse_expenses SET ${setClauses}, updated_at = now() WHERE id = :id RETURNING *`,
            { ...fields, id }
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('updateExpense error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const deleteExpense = async (req: Request, res: Response) => {
    const { id } = req.params;
    const scope = warehouseScope(req);

    try {
        let existingQuery = `SELECT id FROM warehouse_expenses WHERE id = :id`;
        const existingParams: any = { id };
        if (scope !== null) {
            existingQuery += ` AND warehouse_id = ANY(:warehouse_ids)`;
            existingParams.warehouse_ids = scope;
        }
        const existingResult = await execute<any>(existingQuery, existingParams);
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ message: 'Expense entry not found' });
        }

        await execute(`DELETE FROM warehouse_expenses WHERE id = :id`, { id });
        res.json({ message: 'Expense entry deleted' });
    } catch (err) {
        console.error('deleteExpense error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
```

Note: `warehouseScope` is exported (not private to this file) because Task 5 adds two more handlers to this same controller file that need the identical helper — exporting it avoids duplicating the function within the same file.

- [ ] **Step 3: Create `warehouse-server/src/routes/expenseRoutes.ts`**

```typescript
import { Router } from 'express';
import { createExpense, getExpenses, updateExpense, deleteExpense } from '../controllers/expenseController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { createExpenseSchema, updateExpenseSchema, expenseQuerySchema } from '../schemas/expenseSchemas';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('manage_expenses'));

router.get('/', validateQuery(expenseQuerySchema), getExpenses);
router.post('/', validateBody(createExpenseSchema), createExpense);
router.put('/:id', validateBody(updateExpenseSchema), updateExpense);
router.delete('/:id', deleteExpense);

export default router;
```

- [ ] **Step 4: Wire the router into `warehouse-server/src/app.ts`**

Add the import alongside the other route imports:

```typescript
import expenseRoutes from './routes/expenseRoutes';
```

Add the mount alongside the other `app.use('/api/...', ...)` lines:

```typescript
app.use('/api/expenses', expenseRoutes);
```

- [ ] **Step 5: Write the test suite — `warehouse-server/src/tests/expenses.test.ts`**

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

import expenseRoutes from '../routes/expenseRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/expenses', expenseRoutes);

const VALID_BODY = { warehouse_id: 1, expense_date: '2026-09-01', transport_amount: 500, fuel_amount: 1000 };

describe('POST /api/expenses', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('creates an entry with the given amounts, defaulting missing categories to 0', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, WAREHOUSE_ID: 1, EXPENSE_DATE: '2026-09-01', TRANSPORT_AMOUNT: 500, FUEL_AMOUNT: 1000, LABOUR_AMOUNT: 0, MEALS_AMOUNT: 0, OTHER_AMOUNT: 0 }] });

        const res = await request(app).post('/api/expenses').send(VALID_BODY);

        expect(res.status).toBe(201);
        const [, params] = mockExecute.mock.calls[0];
        expect(params).toMatchObject({ warehouse_id: 1, expense_date: '2026-09-01', transport_amount: 500, fuel_amount: 1000, labour_amount: 0, meals_amount: 0, other_amount: 0 });
    });

    it('returns 409 when an entry already exists for that warehouse and date', async () => {
        mockExecute.mockRejectedValueOnce({ code: '23505' });

        const res = await request(app).post('/api/expenses').send(VALID_BODY);

        expect(res.status).toBe(409);
    });

    it('rejects a negative amount', async () => {
        const res = await request(app).post('/api/expenses').send({ ...VALID_BODY, transport_amount: -5 });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('GET /api/expenses', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('filters by warehouse_id and date range', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/expenses?warehouse_id=1&from=2026-09-01&to=2026-09-30');

        expect(res.status).toBe(200);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND we\.warehouse_id = :warehouse_id/);
        expect(query).toMatch(/AND we\.expense_date >= :from/);
        expect(query).toMatch(/AND we\.expense_date <= :to/);
        expect(params).toMatchObject({ warehouse_id: '1', from: '2026-09-01', to: '2026-09-30' });
    });
});

describe('PUT /api/expenses/:id', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('updates the given fields', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] }) // existence check
            .mockResolvedValueOnce({ rows: [{ ID: 1, TRANSPORT_AMOUNT: 750 }] }); // UPDATE

        const res = await request(app).put('/api/expenses/1').send({ transport_amount: 750 });

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[1][0]).toMatch(/UPDATE warehouse_expenses SET transport_amount = :transport_amount, updated_at = now\(\)/);
    });

    it('returns 404 when the entry does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).put('/api/expenses/999').send({ transport_amount: 750 });

        expect(res.status).toBe(404);
    });

    it('rejects a body with no fields to update', async () => {
        const res = await request(app).put('/api/expenses/1').send({});

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('DELETE /api/expenses/:id', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('deletes an existing entry', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1 }] })
            .mockResolvedValueOnce({ rows: [] });

        const res = await request(app).delete('/api/expenses/1');

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[1][0]).toMatch(/DELETE FROM warehouse_expenses/);
    });

    it('returns 404 when the entry does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).delete('/api/expenses/999');

        expect(res.status).toBe(404);
    });
});

describe('POST /api/expenses — warehouse scoping for warehouse_admin', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('rejects creating an entry for a warehouse outside the warehouse_admin\'s warehouse_ids', async () => {
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

        const scopedRoutes = require('../routes/expenseRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/expenses', scopedRoutes);

        const res = await request(scopedApp).post('/api/expenses').send({ ...VALID_BODY, warehouse_id: 1 });

        expect(res.status).toBe(400);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});

describe('GET /api/expenses — warehouse scoping for warehouse_admin', () => {
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

        const scopedRoutes = require('../routes/expenseRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/expenses', scopedRoutes);

        const res = await request(scopedApp).get('/api/expenses');

        expect(res.status).toBe(200);
        const { execute: scopedExecute } = require('../db/dbUtils');
        const [query, params] = scopedExecute.mock.calls[0];
        expect(query).toMatch(/AND we\.warehouse_id = ANY\(:warehouse_ids\)/);
        expect(params.warehouse_ids).toEqual([2]);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd warehouse-server && npx jest expenses --verbose`
Expected: PASS, all cases (3 create + 1 list + 3 update + 2 delete + 1 create-scoping + 1 list-scoping = 11)

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `cd warehouse-server && npm test`
Expected: all suites PASS.

- [ ] **Step 8: Commit**

```bash
git add warehouse-server/src/schemas/expenseSchemas.ts warehouse-server/src/controllers/expenseController.ts warehouse-server/src/routes/expenseRoutes.ts warehouse-server/src/app.ts warehouse-server/src/tests/expenses.test.ts
git commit -m "feat(warehouse-server): add warehouse expense CRUD (create/list/update/delete) with warehouse scoping"
```

---

## Task 5: Monthly summary and cross-warehouse comparison

**Files:**
- Modify: `warehouse-server/src/controllers/expenseController.ts`
- Modify: `warehouse-server/src/routes/expenseRoutes.ts`
- Modify: `warehouse-server/src/schemas/expenseSchemas.ts`
- Modify: `warehouse-server/src/tests/expenses.test.ts`

**Interfaces:**
- Consumes: `computeVariance` (Task 1), `warehouseScope` (Task 4, exported from `expenseController.ts`).
- Produces: `getExpenseSummary`, `getExpenseComparison` — mounted as `GET /expenses/summary` and `GET /expenses/comparison`. Consumed by Task 7 (frontend).

- [ ] **Step 1: Add the two query schemas to `warehouse-server/src/schemas/expenseSchemas.ts`**

Append:

```typescript
export const expenseSummaryQuerySchema = z.object({
    warehouse_id: z.string().optional(),
    year: z.string().regex(/^\d{4}$/, 'year must be a 4-digit number'),
    month: z.string().regex(/^(0?[1-9]|1[0-2])$/, 'month must be 1-12'),
});

export const expenseComparisonQuerySchema = z.object({
    year: z.string().regex(/^\d{4}$/, 'year must be a 4-digit number'),
    month: z.string().regex(/^(0?[1-9]|1[0-2])$/, 'month must be 1-12'),
});
```

- [ ] **Step 2: Add the two handlers to `warehouse-server/src/controllers/expenseController.ts`**

At the top of the file, add this import alongside the existing `import { execute } from '../db/dbUtils';` line:

```typescript
import { computeVariance } from '../utils/expenseVariance';
```

Then append the following to the end of the file (after `deleteExpense`):

```typescript
const CATEGORIES = ['transport_amount', 'fuel_amount', 'labour_amount', 'meals_amount', 'other_amount'] as const;

async function getMonthTotals(warehouseId: number, year: number, month: number): Promise<Record<string, number> | null> {
    const result = await execute<any>(
        `SELECT
            COALESCE(SUM(transport_amount), 0)::float AS transport_amount,
            COALESCE(SUM(fuel_amount), 0)::float AS fuel_amount,
            COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
            COALESCE(SUM(meals_amount), 0)::float AS meals_amount,
            COALESCE(SUM(other_amount), 0)::float AS other_amount,
            COUNT(*)::int AS entry_count
         FROM warehouse_expenses
         WHERE warehouse_id = :warehouse_id
           AND date_trunc('month', expense_date) = make_date(:year::int, :month::int, 1)`,
        { warehouse_id: warehouseId, year, month }
    );
    const row = result.rows[0];
    if (row.ENTRY_COUNT === 0) return null;
    return {
        transport_amount: row.TRANSPORT_AMOUNT,
        fuel_amount: row.FUEL_AMOUNT,
        labour_amount: row.LABOUR_AMOUNT,
        meals_amount: row.MEALS_AMOUNT,
        other_amount: row.OTHER_AMOUNT,
    };
}

export const getExpenseSummary = async (req: Request, res: Response) => {
    const { year, month } = req.query as { year: string; month: string };
    const scope = warehouseScope(req);
    let warehouseId: number | null = req.query.warehouse_id ? Number(req.query.warehouse_id) : null;

    if (scope !== null) {
        warehouseId = scope[0] ?? null;
    }
    if (!warehouseId) {
        return res.status(400).json({ message: 'warehouse_id is required' });
    }

    try {
        const y = Number(year);
        const m = Number(month);
        const priorY = m === 1 ? y - 1 : y;
        const priorM = m === 1 ? 12 : m - 1;

        const current = await getMonthTotals(warehouseId, y, m);
        const prior = await getMonthTotals(warehouseId, priorY, priorM);

        const categories: Record<string, any> = {};
        for (const cat of CATEGORIES) {
            const currentVal = current ? current[cat] : 0;
            const priorVal = prior ? prior[cat] : null;
            categories[cat] = {
                current: currentVal,
                variance: computeVariance(currentVal, priorVal),
            };
        }

        res.json({ warehouse_id: warehouseId, year: y, month: m, categories });
    } catch (err) {
        console.error('getExpenseSummary error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getExpenseComparison = async (req: Request, res: Response) => {
    const { year, month } = req.query as { year: string; month: string };
    const scope = warehouseScope(req);
    try {
        let query = `
            SELECT w.id AS warehouse_id, w.name AS warehouse_name,
                   COALESCE(SUM(we.transport_amount + we.fuel_amount + we.labour_amount + we.meals_amount + we.other_amount), 0)::float AS total_amount
            FROM warehouses w
            LEFT JOIN warehouse_expenses we ON we.warehouse_id = w.id
                AND date_trunc('month', we.expense_date) = make_date(:year::int, :month::int, 1)
            WHERE 1=1
        `;
        const params: any = { year: Number(year), month: Number(month) };
        if (scope !== null) {
            query += ` AND w.id = ANY(:warehouse_ids)`;
            params.warehouse_ids = scope;
        }
        query += ` GROUP BY w.id, w.name ORDER BY w.name`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getExpenseComparison error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
```

- [ ] **Step 3: Wire the two new routes into `warehouse-server/src/routes/expenseRoutes.ts`**

Update the imports and add the two `GET` routes (order matters: Express matches `/summary` and `/comparison` before the parameterized `/:id`-style routes only because those routes use `PUT`/`DELETE`, not `GET` — but place `/summary` and `/comparison` before the plain `GET /` route text-wise for readability, not because of a routing conflict, since there is no `GET /:id` route in this router at all):

```typescript
import { Router } from 'express';
import { createExpense, getExpenses, updateExpense, deleteExpense, getExpenseSummary, getExpenseComparison } from '../controllers/expenseController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/permissionMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { createExpenseSchema, updateExpenseSchema, expenseQuerySchema, expenseSummaryQuerySchema, expenseComparisonQuerySchema } from '../schemas/expenseSchemas';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('manage_expenses'));

router.get('/summary', validateQuery(expenseSummaryQuerySchema), getExpenseSummary);
router.get('/comparison', validateQuery(expenseComparisonQuerySchema), getExpenseComparison);
router.get('/', validateQuery(expenseQuerySchema), getExpenses);
router.post('/', validateBody(createExpenseSchema), createExpense);
router.put('/:id', validateBody(updateExpenseSchema), updateExpense);
router.delete('/:id', deleteExpense);

export default router;
```

- [ ] **Step 4: Add tests to `warehouse-server/src/tests/expenses.test.ts`**

Append:

```typescript
describe('GET /api/expenses/summary', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('computes per-category variance against the prior month', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ TRANSPORT_AMOUNT: 1500, FUEL_AMOUNT: 2000, LABOUR_AMOUNT: 500, MEALS_AMOUNT: 300, OTHER_AMOUNT: 100, ENTRY_COUNT: 20 }] }) // current month
            .mockResolvedValueOnce({ rows: [{ TRANSPORT_AMOUNT: 1000, FUEL_AMOUNT: 2000, LABOUR_AMOUNT: 500, MEALS_AMOUNT: 300, OTHER_AMOUNT: 100, ENTRY_COUNT: 18 }] }); // prior month

        const res = await request(app).get('/api/expenses/summary?warehouse_id=1&year=2026&month=9');

        expect(res.status).toBe(200);
        expect(res.body.categories.transport_amount).toEqual({ current: 1500, variance: { value: 500, percent: 50 } });
        expect(res.body.categories.fuel_amount).toEqual({ current: 2000, variance: { value: 0, percent: 0 } });
    });

    it('returns null variance when the prior month has no entries', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ TRANSPORT_AMOUNT: 1500, FUEL_AMOUNT: 0, LABOUR_AMOUNT: 0, MEALS_AMOUNT: 0, OTHER_AMOUNT: 0, ENTRY_COUNT: 5 }] })
            .mockResolvedValueOnce({ rows: [{ TRANSPORT_AMOUNT: 0, FUEL_AMOUNT: 0, LABOUR_AMOUNT: 0, MEALS_AMOUNT: 0, OTHER_AMOUNT: 0, ENTRY_COUNT: 0 }] });

        const res = await request(app).get('/api/expenses/summary?warehouse_id=1&year=2026&month=9');

        expect(res.status).toBe(200);
        expect(res.body.categories.transport_amount).toEqual({ current: 1500, variance: { value: null, percent: null } });
    });

    it('queries December as the prior month when the requested month is January', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [{ TRANSPORT_AMOUNT: 100, FUEL_AMOUNT: 0, LABOUR_AMOUNT: 0, MEALS_AMOUNT: 0, OTHER_AMOUNT: 0, ENTRY_COUNT: 3 }] })
            .mockResolvedValueOnce({ rows: [{ TRANSPORT_AMOUNT: 100, FUEL_AMOUNT: 0, LABOUR_AMOUNT: 0, MEALS_AMOUNT: 0, OTHER_AMOUNT: 0, ENTRY_COUNT: 3 }] });

        const res = await request(app).get('/api/expenses/summary?warehouse_id=1&year=2026&month=1');

        expect(res.status).toBe(200);
        const priorMonthParams = mockExecute.mock.calls[1][1];
        expect(priorMonthParams).toMatchObject({ year: 2025, month: 12 });
    });

    it('returns 400 when no warehouse_id is given and the requester is unscoped', async () => {
        const res = await request(app).get('/api/expenses/summary?year=2026&month=9');

        expect(res.status).toBe(400);
    });
});

describe('GET /api/expenses/comparison', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('returns one row per warehouse with its monthly total', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [
            { WAREHOUSE_ID: 1, WAREHOUSE_NAME: 'Dagonna', TOTAL_AMOUNT: 5000 },
            { WAREHOUSE_ID: 2, WAREHOUSE_NAME: 'Mt. Lavinia', TOTAL_AMOUNT: 3000 },
        ] });

        const res = await request(app).get('/api/expenses/comparison?year=2026&month=9');

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/make_date\(:year::int, :month::int, 1\)/);
        expect(params).toMatchObject({ year: 2026, month: 9 });
    });
});

describe('GET /api/expenses/comparison — warehouse scoping for warehouse_admin', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('scopes results to the warehouse_admin\'s own warehouse', async () => {
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
            execute.mockResolvedValueOnce({ rows: [{ WAREHOUSE_ID: 2, WAREHOUSE_NAME: 'Mt. Lavinia', TOTAL_AMOUNT: 3000 }] });
            return { execute };
        });

        const scopedRoutes = require('../routes/expenseRoutes').default;
        const scopedApp = express();
        scopedApp.use(express.json());
        scopedApp.use('/api/expenses', scopedRoutes);

        const res = await request(scopedApp).get('/api/expenses/comparison?year=2026&month=9');

        expect(res.status).toBe(200);
        const { execute: scopedExecute } = require('../db/dbUtils');
        const [query, params] = scopedExecute.mock.calls[0];
        expect(query).toMatch(/AND w\.id = ANY\(:warehouse_ids\)/);
        expect(params.warehouse_ids).toEqual([2]);

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd warehouse-server && npx jest expenses --verbose`
Expected: PASS, all cases (11 from Task 4 + 4 summary + 1 comparison + 1 comparison-scoping = 17)

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `cd warehouse-server && npm test`
Expected: all suites PASS.

- [ ] **Step 7: Commit**

```bash
git add warehouse-server/src/controllers/expenseController.ts warehouse-server/src/routes/expenseRoutes.ts warehouse-server/src/schemas/expenseSchemas.ts warehouse-server/src/tests/expenses.test.ts
git commit -m "feat(warehouse-server): add expense monthly summary (with variance) and cross-warehouse comparison endpoints"
```

---

## Task 6: Frontend — types and navigation

**Files:**
- Modify: `warehouse-client/src/types.ts`
- Modify: `warehouse-client/src/components/Layout.tsx`

**Interfaces:**
- Produces: `WarehouseExpense`, `ExpenseSummary`, `ExpenseComparisonRow` types — consumed by Task 7. `PermissionKey` gains `'manage_expenses'` on the frontend, matching Task 3's backend addition. `Layout.tsx` gains an "Expenses" nav item gated on `manage_expenses`.

- [ ] **Step 1: Modify `warehouse-client/src/types.ts`**

Change:

```typescript
export type PermissionKey =
    | 'manage_companies'
    | 'manage_warehouses'
    | 'manage_box_events'
    | 'view_invoices'
    | 'manage_invoices'
    | 'manage_users';
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
    | 'manage_expenses';
```

Append these new interfaces at the end of the file:

```typescript
export interface WarehouseExpense {
    ID: number;
    WAREHOUSE_ID: number;
    WAREHOUSE_NAME?: string;
    EXPENSE_DATE: string;
    TRANSPORT_AMOUNT: number;
    FUEL_AMOUNT: number;
    LABOUR_AMOUNT: number;
    MEALS_AMOUNT: number;
    OTHER_AMOUNT: number;
    REMARKS: string | null;
    CREATED_AT: string;
    UPDATED_AT: string;
}

export interface ExpenseCategorySummary {
    current: number;
    variance: { value: number | null; percent: number | null };
}

export interface ExpenseSummary {
    warehouse_id: number;
    year: number;
    month: number;
    categories: {
        transport_amount: ExpenseCategorySummary;
        fuel_amount: ExpenseCategorySummary;
        labour_amount: ExpenseCategorySummary;
        meals_amount: ExpenseCategorySummary;
        other_amount: ExpenseCategorySummary;
    };
}

export interface ExpenseComparisonRow {
    WAREHOUSE_ID: number;
    WAREHOUSE_NAME: string;
    TOTAL_AMOUNT: number;
}
```

- [ ] **Step 2: Modify `warehouse-client/src/components/Layout.tsx`**

Add `Wallet` to the `lucide-react` import:

```typescript
import { LayoutDashboard, Building2, Warehouse, PackageSearch, BarChart3, Users, Receipt, Wallet, LogOut, KeyRound } from 'lucide-react';
```

Add the "Expenses" item to the `navItems` array, gated on `manage_expenses`:

```typescript
    const navItems = [
        ...NAV_ITEMS,
        ...(permissions.includes('manage_expenses') ? [{ to: '/expenses', label: 'Expenses', icon: Wallet }] : []),
        ...(permissions.includes('manage_users') ? [{ to: '/users', label: 'Users', icon: Users }] : []),
        ...(permissions.includes('view_invoices') ? [{ to: '/invoices', label: 'Invoices', icon: Receipt }] : []),
    ];
```

- [ ] **Step 3: Add the route in `warehouse-client/src/App.tsx`**

Read the file first to see the existing `<Route>` list inside the authenticated layout. Add, alongside the existing routes (e.g. next to `box-events`):

```tsx
                    <Route path="expenses" element={<Expenses />} />
```

and add the corresponding import near the top of the file alongside the other page imports:

```typescript
import Expenses from './pages/Expenses';
```

(`Expenses.tsx` doesn't exist yet — Task 7 creates it. This import will be a compile error until Task 7 runs; that's expected and resolved by the very next task, matching how this plan's earlier RBAC work sequenced type-then-usage across tasks.)

- [ ] **Step 4: Verify the build fails only on the missing `./pages/Expenses` module**

Run: `cd warehouse-client && npm run build`
Expected: fails with a "Cannot find module './pages/Expenses'" error (or equivalent) — and no OTHER error. If you see any other TypeScript error, stop and report it; that would mean something in Step 1 or Step 2 is wrong, not merely incomplete.

- [ ] **Step 5: Commit**

```bash
git add warehouse-client/src/types.ts warehouse-client/src/components/Layout.tsx warehouse-client/src/App.tsx
git commit -m "feat(warehouse-client): add manage_expenses permission key, Expense types, and Expenses nav item"
```

---

## Task 7: Frontend — Expenses page

**Files:**
- Create: `warehouse-client/src/pages/Expenses.tsx`

**Interfaces:**
- Consumes: `WarehouseExpense`, `ExpenseSummary`, `ExpenseComparisonRow`, `Warehouse` (Task 6/existing `types.ts`), `GET/POST/PUT/DELETE /expenses`, `GET /expenses/summary`, `GET /expenses/comparison` (Tasks 4/5), `useAuth` (existing `context/AuthContext.tsx`).
- Produces: the `Expenses` page component, resolving Task 6's dangling import.

- [ ] **Step 1: Create `warehouse-client/src/pages/Expenses.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Check, X } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Warehouse, WarehouseExpense, ExpenseSummary, ExpenseComparisonRow } from '../types';

const CATEGORY_FIELDS = [
    { key: 'transport_amount', label: 'Transport/Parking' },
    { key: 'fuel_amount', label: 'Fuel' },
    { key: 'labour_amount', label: 'Labour' },
    { key: 'meals_amount', label: 'Meals & Refreshments' },
    { key: 'other_amount', label: 'Other' },
] as const;

type CategoryKey = typeof CATEGORY_FIELDS[number]['key'];

function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

const Expenses: React.FC = () => {
    const { user } = useAuth();
    const canManageExpenses = user?.EFFECTIVE_PERMISSIONS?.includes('manage_expenses') ?? false;
    const isSystemAdmin = user?.ROLE === 'system_admin';

    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [entries, setEntries] = useState<WarehouseExpense[]>([]);
    const [loading, setLoading] = useState(canManageExpenses);

    const [formWarehouseId, setFormWarehouseId] = useState('');
    const [formDate, setFormDate] = useState(todayISO());
    const [formAmounts, setFormAmounts] = useState<Record<CategoryKey, string>>({
        transport_amount: '', fuel_amount: '', labour_amount: '', meals_amount: '', other_amount: '',
    });
    const [formRemarks, setFormRemarks] = useState('');
    const [existingEntryId, setExistingEntryId] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const [editingId, setEditingId] = useState<number | null>(null);
    const [editAmounts, setEditAmounts] = useState<Record<CategoryKey, string>>({
        transport_amount: '', fuel_amount: '', labour_amount: '', meals_amount: '', other_amount: '',
    });
    const [editRemarks, setEditRemarks] = useState('');

    const [summary, setSummary] = useState<ExpenseSummary | null>(null);
    const [summaryYear, setSummaryYear] = useState(new Date().getFullYear());
    const [summaryMonth, setSummaryMonth] = useState(new Date().getMonth() + 1);
    const [comparison, setComparison] = useState<ExpenseComparisonRow[]>([]);

    const loadEntries = () => {
        api.get<WarehouseExpense[]>('/expenses').then((res) => setEntries(res.data));
    };

    useEffect(() => {
        if (!canManageExpenses) return;
        Promise.all([
            api.get<Warehouse[]>('/warehouses'),
            api.get<WarehouseExpense[]>('/expenses'),
        ]).then(([warehousesRes, entriesRes]) => {
            setWarehouses(warehousesRes.data);
            setEntries(entriesRes.data);
            if (!isSystemAdmin && warehousesRes.data.length === 1) {
                setFormWarehouseId(String(warehousesRes.data[0].ID));
            }
        }).finally(() => setLoading(false));
    }, [canManageExpenses, isSystemAdmin]);

    // Pre-fill (and switch to edit mode) when a same-day entry already exists
    // for the selected warehouse — matches UC-5's "pre-filled... enters
    // amounts" re-entry flow.
    useEffect(() => {
        if (!formWarehouseId || !formDate) {
            setExistingEntryId(null);
            return;
        }
        api.get<WarehouseExpense[]>('/expenses', { params: { warehouse_id: formWarehouseId, from: formDate, to: formDate } })
            .then((res) => {
                const existing = res.data[0];
                if (existing) {
                    setExistingEntryId(existing.ID);
                    setFormAmounts({
                        transport_amount: String(existing.TRANSPORT_AMOUNT),
                        fuel_amount: String(existing.FUEL_AMOUNT),
                        labour_amount: String(existing.LABOUR_AMOUNT),
                        meals_amount: String(existing.MEALS_AMOUNT),
                        other_amount: String(existing.OTHER_AMOUNT),
                    });
                    setFormRemarks(existing.REMARKS || '');
                } else {
                    setExistingEntryId(null);
                }
            });
    }, [formWarehouseId, formDate]);

    const loadSummary = (warehouseId: string, year: number, month: number) => {
        if (!warehouseId) return;
        api.get<ExpenseSummary>('/expenses/summary', { params: { warehouse_id: warehouseId, year, month } })
            .then((res) => setSummary(res.data));
    };

    useEffect(() => {
        loadSummary(formWarehouseId, summaryYear, summaryMonth);
    }, [formWarehouseId, summaryYear, summaryMonth]);

    useEffect(() => {
        if (!isSystemAdmin) return;
        api.get<ExpenseComparisonRow[]>('/expenses/comparison', { params: { year: summaryYear, month: summaryMonth } })
            .then((res) => setComparison(res.data));
    }, [isSystemAdmin, summaryYear, summaryMonth]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        const payload: any = { remarks: formRemarks || undefined };
        for (const { key } of CATEGORY_FIELDS) {
            payload[key] = formAmounts[key] ? Number(formAmounts[key]) : 0;
        }
        try {
            if (existingEntryId) {
                await api.put(`/expenses/${existingEntryId}`, payload);
                toast.success('Expense entry updated');
            } else {
                await api.post('/expenses', { ...payload, warehouse_id: Number(formWarehouseId), expense_date: formDate });
                toast.success('Expense entry saved');
            }
            loadEntries();
            loadSummary(formWarehouseId, summaryYear, summaryMonth);
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to save expense entry');
        } finally {
            setSubmitting(false);
        }
    };

    const startEdit = (entry: WarehouseExpense) => {
        setEditingId(entry.ID);
        setEditAmounts({
            transport_amount: String(entry.TRANSPORT_AMOUNT),
            fuel_amount: String(entry.FUEL_AMOUNT),
            labour_amount: String(entry.LABOUR_AMOUNT),
            meals_amount: String(entry.MEALS_AMOUNT),
            other_amount: String(entry.OTHER_AMOUNT),
        });
        setEditRemarks(entry.REMARKS || '');
    };

    const cancelEdit = () => setEditingId(null);

    const saveEdit = async (id: number) => {
        const payload: any = { remarks: editRemarks || undefined };
        for (const { key } of CATEGORY_FIELDS) {
            payload[key] = editAmounts[key] ? Number(editAmounts[key]) : 0;
        }
        try {
            await api.put(`/expenses/${id}`, payload);
            toast.success('Expense entry updated');
            setEditingId(null);
            loadEntries();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update expense entry');
        }
    };

    if (!canManageExpenses) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Warehouse Expenses</h1>

            <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    {isSystemAdmin && (
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Warehouse</label>
                            <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={formWarehouseId} onChange={(e) => setFormWarehouseId(e.target.value)} required>
                                <option value="">Select...</option>
                                {warehouses.map((w) => (
                                    <option key={w.ID} value={w.ID}>{w.NAME}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
                        <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={formDate} onChange={(e) => setFormDate(e.target.value)} required />
                    </div>
                </div>
                <div className="grid grid-cols-5 gap-3">
                    {CATEGORY_FIELDS.map(({ key, label }) => (
                        <div key={key}>
                            <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
                            <input type="number" min="0" step="0.01" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={formAmounts[key]} onChange={(e) => setFormAmounts((prev) => ({ ...prev, [key]: e.target.value }))} />
                        </div>
                    ))}
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Remarks</label>
                    <input className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={formRemarks} onChange={(e) => setFormRemarks(e.target.value)} />
                </div>
                <button type="submit" disabled={submitting || !formWarehouseId} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {submitting ? 'Saving...' : existingEntryId ? 'Update Entry' : 'Save Entry'}
                </button>
            </form>

            {summary && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold text-slate-700">Monthly Summary</h2>
                        <div className="flex gap-2">
                            <select className="border border-slate-300 rounded px-2 py-1 text-sm" value={summaryMonth} onChange={(e) => setSummaryMonth(Number(e.target.value))}>
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                            <input type="number" className="border border-slate-300 rounded px-2 py-1 text-sm w-20" value={summaryYear} onChange={(e) => setSummaryYear(Number(e.target.value))} />
                        </div>
                    </div>
                    <table className="w-full text-sm">
                        <thead className="text-left text-slate-500">
                            <tr>
                                <th className="p-2">Category</th>
                                <th className="p-2">This Month</th>
                                <th className="p-2">Variance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {CATEGORY_FIELDS.map(({ key, label }) => {
                                const cat = summary.categories[key];
                                return (
                                    <tr key={key} className="border-t border-slate-100">
                                        <td className="p-2">{label}</td>
                                        <td className="p-2">{cat.current.toFixed(2)}</td>
                                        <td className="p-2">
                                            {cat.variance.value === null
                                                ? <span className="text-slate-400">N/A</span>
                                                : <span className={cat.variance.value >= 0 ? 'text-red-600' : 'text-green-600'}>
                                                    {cat.variance.value >= 0 ? '+' : ''}{cat.variance.value.toFixed(2)}
                                                    {cat.variance.percent !== null && ` (${cat.variance.percent >= 0 ? '+' : ''}${cat.variance.percent.toFixed(1)}%)`}
                                                  </span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {isSystemAdmin && comparison.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <h2 className="text-sm font-semibold text-slate-700 mb-3">Cross-Warehouse Comparison</h2>
                    <table className="w-full text-sm">
                        <thead className="text-left text-slate-500">
                            <tr>
                                <th className="p-2">Warehouse</th>
                                <th className="p-2">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {comparison.map((row) => (
                                <tr key={row.WAREHOUSE_ID} className="border-t border-slate-100">
                                    <td className="p-2">{row.WAREHOUSE_NAME}</td>
                                    <td className="p-2">{row.TOTAL_AMOUNT.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Date</th>
                            {isSystemAdmin && <th className="p-3">Warehouse</th>}
                            {CATEGORY_FIELDS.map(({ key, label }) => (
                                <th key={key} className="p-3">{label}</th>
                            ))}
                            <th className="p-3">Remarks</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((entry) =>
                            editingId === entry.ID ? (
                                <tr key={entry.ID} className="border-t border-slate-100 bg-slate-50">
                                    <td className="p-3">{entry.EXPENSE_DATE}</td>
                                    {isSystemAdmin && <td className="p-3">{entry.WAREHOUSE_NAME}</td>}
                                    {CATEGORY_FIELDS.map(({ key }) => (
                                        <td key={key} className="p-2">
                                            <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editAmounts[key]} onChange={(e) => setEditAmounts((prev) => ({ ...prev, [key]: e.target.value }))} />
                                        </td>
                                    ))}
                                    <td className="p-2">
                                        <input className="border border-slate-300 rounded px-2 py-1 w-full" value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <div className="flex gap-2">
                                            <button onClick={() => saveEdit(entry.ID)} className="text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                                            <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={entry.ID} className="border-t border-slate-100">
                                    <td className="p-3">{entry.EXPENSE_DATE}</td>
                                    {isSystemAdmin && <td className="p-3">{entry.WAREHOUSE_NAME}</td>}
                                    <td className="p-3">{entry.TRANSPORT_AMOUNT.toFixed(2)}</td>
                                    <td className="p-3">{entry.FUEL_AMOUNT.toFixed(2)}</td>
                                    <td className="p-3">{entry.LABOUR_AMOUNT.toFixed(2)}</td>
                                    <td className="p-3">{entry.MEALS_AMOUNT.toFixed(2)}</td>
                                    <td className="p-3">{entry.OTHER_AMOUNT.toFixed(2)}</td>
                                    <td className="p-3">{entry.REMARKS}</td>
                                    <td className="p-3">
                                        <button onClick={() => startEdit(entry)} className="text-slate-500 hover:text-blue-600" title="Edit"><Pencil size={16} /></button>
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

export default Expenses;
```

Note: the header row in the "Actions" `<th>` and the data rows' column counts differ from the `CATEGORY_FIELDS` re-render in the read-only row above — this is intentional and matches the file's own literal columns (`TRANSPORT_AMOUNT`/`FUEL_AMOUNT`/etc. spelled out) rather than a `.map()` over `CATEGORY_FIELDS`, since `WarehouseExpense`'s fields are named properties, not a dictionary; this is consistent with how `BoxEvents.tsx` also spells out its columns literally rather than mapping over a shape-derived list.

- [ ] **Step 2: Verify the build succeeds**

Run: `cd warehouse-client && npm run build`
Expected: succeeds with 0 TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add warehouse-client/src/pages/Expenses.tsx
git commit -m "feat(warehouse-client): add Expenses page with daily entry form, monthly summary, and cross-warehouse comparison"
```

---

## Task 8: Manual end-to-end verification

**Files:** None (verification only).

- [ ] **Step 1: Start the stack**

```bash
cd warehouse-server && npm run dev
cd warehouse-client && npm run dev
```

Confirm the server boots cleanly against the real `wh-postgres` database (the `warehouse_expenses` table and widened `manage_expenses` permission already exist from Task 2's live verification, so this should be a normal boot).

- [ ] **Step 2: Golden path as `system_admin`**

1. Log in as `system_admin`. Confirm "Expenses" appears in the nav.
2. Create a daily expense entry for one warehouse, filling in a few categories and remarks. Save — confirm it appears in the entries table.
3. Re-open the same warehouse+date (reload the page, keep the same date) — confirm the form pre-fills with the saved values and the submit button reads "Update Entry", not "Save Entry".
4. Edit one entry inline via the table's pencil icon — confirm the change persists.
5. Confirm the Monthly Summary panel shows the entry's amounts under "This Month", and "N/A" (not a number) for variance, since there's no prior-month data yet.
6. Create a second entry, dated in the previous calendar month, for the same warehouse and category. Reload — confirm the Monthly Summary panel now shows a real variance value/percentage instead of "N/A".
7. Confirm the Cross-Warehouse Comparison table appears (system_admin only) and lists every warehouse, including ones with zero expense entries for the month (showing a 0.00 total, not being omitted).

- [ ] **Step 3: Log in as a `warehouse_admin`**

1. Confirm "Expenses" appears in the nav (role default includes `manage_expenses`) but the warehouse picker in the form is absent — their own warehouse is used automatically.
2. Confirm only their own warehouse's entries appear in the table (create an entry as `system_admin` for a *different* warehouse first, then confirm this `warehouse_admin` does not see it).
3. Attempt (via direct API call, since the UI won't offer it) to `POST /expenses` with a `warehouse_id` outside their scope — confirm 400.
4. Confirm the Cross-Warehouse Comparison table is absent for this role (only `system_admin` sees it), and that calling `GET /expenses/comparison` directly returns only their own warehouse's row.

- [ ] **Step 4: Log in as a `finance_officer`**

1. Confirm "Expenses" does NOT appear in the nav (no default `manage_expenses`).
2. Confirm every `/api/expenses*` route returns 403 for this role.

- [ ] **Step 5: Report results**

If everything in Steps 2-4 passes, this task is complete — no commit (verification only). If anything fails, fix it under the relevant earlier task and re-verify.
