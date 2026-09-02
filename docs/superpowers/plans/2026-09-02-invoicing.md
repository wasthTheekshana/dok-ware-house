# Invoicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins configure flat per-department box pricing, preview a computed invoice for a department/period from actual `box_events`, and save it as a permanent record — replacing the manual Excel invoicing workbook for the common (non-tiered) case.

**Architecture:** Extends the existing `warehouse-server`/`warehouse-client` app. Backend: a pure `computeInvoiceAmounts` function (TDD'd standalone, mirrors `boxCount.ts`'s approach), three new pricing columns on `departments`, a new `invoices` table, and an `invoiceController`/`invoiceRoutes`/`invoiceSchemas` trio that is admin-gated on every route (including reads — this is the one module in the app where even GET requires admin, since it's financial data). Frontend: inline price editing added to the Company Detail page's departments table, and a new admin-only Invoices page (preview + save + history).

**Tech Stack:** Same as the rest of `warehouse-server`/`warehouse-client` — Express 5 + TypeScript + `pg` + zod + Jest/supertest (backend), React 19 + TypeScript + TailwindCSS + `lucide-react` (frontend). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-02-invoicing-design.md](../specs/2026-09-02-invoicing-design.md)

## Global Constraints

- Flat (non-tiered) per-department pricing only in this version — no volume/tiered pricing.
- Invoices are per-department, never rolled up to company level.
- `POST /invoices` never trusts client-submitted amounts — it always recomputes from `box_events` and the department's *current* prices using only `department_id`/`period_from`/`period_to` from the request body.
- Saved invoices are immutable — no `PUT /invoices/:id`. Correct a mistake by deleting (`DELETE /invoices/:id`) and regenerating.
- Every route in the invoices module is admin-only, including `GET` — unlike Companies/Warehouses (open reads), invoicing is sensitive financial data.
- Tax rates come from environment variables `SSCL_RATE` (default `0.025641`, ≈2.5641%) and `VAT_RATE` (default `0.18`), never stored per-invoice or edited through the UI. SSCL applies to the box-charge subtotal; VAT applies to the SSCL-inclusive amount (`vat_amount = (subtotal + sscl_amount) * VAT_RATE`).
- Row objects returned from `execute()` have UPPERCASE keys. A hand-built (non-`execute()`) response object — like the preview breakdown, before anything is inserted — must also use UPPERCASE keys, so `POST /invoices/preview` and `POST /invoices`'s responses have an identical shape the frontend can render with one code path.
- All SQL through `execute()`/`withTransaction()` in `warehouse-server/src/db/dbUtils.ts` using named `:param` placeholders — never inline string-interpolated SQL.

---

## Task 1: Invoice amount calculation (pure function, TDD)

**Files:**
- Create: `warehouse-server/src/utils/invoiceCalc.ts`
- Test: `warehouse-server/src/tests/invoiceCalc.test.ts`

**Interfaces:**
- Produces: `computeInvoiceAmounts(archivedCount: number, retrievedCount: number, emptyCartonCount: number, prices: {archived: number, retrieved: number, emptyCarton: number}, ssclRate: number, vatRate: number): {subtotal: number, ssclAmount: number, vatAmount: number, totalAmount: number}` — consumed by Task 4's `invoiceController`.

- [ ] **Step 1: Write the failing test — `warehouse-server/src/tests/invoiceCalc.test.ts`**

```typescript
/// <reference types="jest" />
import { computeInvoiceAmounts } from '../utils/invoiceCalc';

describe('computeInvoiceAmounts', () => {
    it('returns all zeros when counts are zero', () => {
        expect(computeInvoiceAmounts(0, 0, 0, { archived: 50, retrieved: 45, emptyCarton: 20 }, 0.025641, 0.18))
            .toEqual({ subtotal: 0, ssclAmount: 0, vatAmount: 0, totalAmount: 0 });
    });

    it('returns all zeros when prices are zero, regardless of counts', () => {
        expect(computeInvoiceAmounts(100, 20, 5, { archived: 0, retrieved: 0, emptyCarton: 0 }, 0.025641, 0.18))
            .toEqual({ subtotal: 0, ssclAmount: 0, vatAmount: 0, totalAmount: 0 });
    });

    it('computes subtotal as the sum of each event type at its own price', () => {
        const result = computeInvoiceAmounts(100, 20, 5, { archived: 50, retrieved: 45, emptyCarton: 20 }, 0.025641, 0.18);
        expect(result.subtotal).toBe(6000);
    });

    it('applies SSCL to the subtotal, then VAT to the SSCL-inclusive amount', () => {
        const result = computeInvoiceAmounts(100, 20, 5, { archived: 50, retrieved: 45, emptyCarton: 20 }, 0.025641, 0.18);
        expect(result.ssclAmount).toBe(153.85);
        expect(result.vatAmount).toBe(1107.69);
        expect(result.totalAmount).toBe(7261.54);
    });

    it('rounds every amount to 2 decimal places', () => {
        const result = computeInvoiceAmounts(1, 0, 0, { archived: 33.33, retrieved: 0, emptyCarton: 0 }, 0.025641, 0.18);
        expect(Number.isInteger(result.subtotal * 100)).toBe(true);
        expect(Number.isInteger(result.ssclAmount * 100)).toBe(true);
        expect(Number.isInteger(result.vatAmount * 100)).toBe(true);
        expect(Number.isInteger(result.totalAmount * 100)).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd warehouse-server && npx jest invoiceCalc -v`
Expected: FAIL with "Cannot find module '../utils/invoiceCalc'"

- [ ] **Step 3: Create `warehouse-server/src/utils/invoiceCalc.ts`**

```typescript
export interface InvoicePrices {
    archived: number;
    retrieved: number;
    emptyCarton: number;
}

export interface InvoiceAmounts {
    subtotal: number;
    ssclAmount: number;
    vatAmount: number;
    totalAmount: number;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export function computeInvoiceAmounts(
    archivedCount: number,
    retrievedCount: number,
    emptyCartonCount: number,
    prices: InvoicePrices,
    ssclRate: number,
    vatRate: number
): InvoiceAmounts {
    const subtotal = round2(
        archivedCount * prices.archived +
        retrievedCount * prices.retrieved +
        emptyCartonCount * prices.emptyCarton
    );
    const ssclAmount = round2(subtotal * ssclRate);
    const vatAmount = round2((subtotal + ssclAmount) * vatRate);
    const totalAmount = round2(subtotal + ssclAmount + vatAmount);
    return { subtotal, ssclAmount, vatAmount, totalAmount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd warehouse-server && npx jest invoiceCalc -v`
Expected: PASS, all 5 cases

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/utils/invoiceCalc.ts warehouse-server/src/tests/invoiceCalc.test.ts
git commit -m "feat(warehouse-server): add invoice amount calculation with TDD"
```

---

## Task 2: Data model — department pricing columns + invoices table

**Files:**
- Modify: `warehouse-server/src/db/config.ts`
- Modify: `warehouse-server/.env.example`

**Interfaces:**
- Produces: three new columns on `departments` (`price_per_archived_box`, `price_per_retrieved_box`, `price_per_empty_carton`) and an `invoices` table — consumed by Tasks 3 and 4.

- [ ] **Step 1: Add pricing columns to the `departments` table definition**

In `warehouse-server/src/db/config.ts`, change the `departments` table's `CREATE TABLE IF NOT EXISTS` block from:

```typescript
        await client.query(`
            CREATE TABLE IF NOT EXISTS departments (
                id                 INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                warehouse_id       INTEGER NOT NULL REFERENCES warehouses(id),
                name               VARCHAR(200) NOT NULL,
                code               VARCHAR(32),
                status             VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
                current_box_count  INTEGER NOT NULL DEFAULT 0 CHECK (current_box_count >= 0),
                created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (company_id, name)
            )
        `);
```

to:

```typescript
        await client.query(`
            CREATE TABLE IF NOT EXISTS departments (
                id                        INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                company_id                INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                warehouse_id              INTEGER NOT NULL REFERENCES warehouses(id),
                name                      VARCHAR(200) NOT NULL,
                code                      VARCHAR(32),
                status                    VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
                current_box_count         INTEGER NOT NULL DEFAULT 0 CHECK (current_box_count >= 0),
                price_per_archived_box    NUMERIC(12,2) NOT NULL DEFAULT 0,
                price_per_retrieved_box   NUMERIC(12,2) NOT NULL DEFAULT 0,
                price_per_empty_carton    NUMERIC(12,2) NOT NULL DEFAULT 0,
                created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (company_id, name)
            )
        `);
```

- [ ] **Step 2: Add the `invoices` table, after the `box_events` table's indexes and before `client.release()`**

Insert this block right after the two `CREATE INDEX IF NOT EXISTS idx_box_events_...` calls:

```typescript
        await client.query(`
            CREATE TABLE IF NOT EXISTS invoices (
                id                        INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                department_id             INTEGER NOT NULL REFERENCES departments(id),
                company_id                INTEGER NOT NULL REFERENCES companies(id),
                department_name           VARCHAR(200) NOT NULL,
                company_name              VARCHAR(200) NOT NULL,
                period_from               DATE NOT NULL,
                period_to                 DATE NOT NULL,
                archived_count            INTEGER NOT NULL DEFAULT 0,
                retrieved_count           INTEGER NOT NULL DEFAULT 0,
                empty_carton_count        INTEGER NOT NULL DEFAULT 0,
                price_per_archived_box    NUMERIC(12,2) NOT NULL,
                price_per_retrieved_box   NUMERIC(12,2) NOT NULL,
                price_per_empty_carton    NUMERIC(12,2) NOT NULL,
                subtotal                  NUMERIC(14,2) NOT NULL,
                sscl_amount               NUMERIC(14,2) NOT NULL,
                vat_amount                NUMERIC(14,2) NOT NULL,
                total_amount              NUMERIC(14,2) NOT NULL,
                created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
                created_by                INTEGER REFERENCES users(id)
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_invoices_department ON invoices(department_id)
        `);
```

Note: no `ON DELETE CASCADE` on `department_id`/`company_id` — an invoice is a financial record that should not disappear if a department is later deactivated.

- [ ] **Step 3: Document the new env vars in `warehouse-server/.env.example`**

Append to the end of the file:

```env
SSCL_RATE=0.025641
VAT_RATE=0.18
```

- [ ] **Step 4: Verify the existing test suite still passes**

Run: `cd warehouse-server && npm test`
Expected: PASS, same count as before this change.

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/db/config.ts warehouse-server/.env.example
git commit -m "feat(warehouse-server): add department pricing columns and invoices table"
```

---

## Task 3: Backend — expose and update department pricing

**Files:**
- Modify: `warehouse-server/src/schemas/departmentSchemas.ts`
- Modify: `warehouse-server/src/controllers/departmentController.ts`
- Modify: `warehouse-server/src/controllers/companyController.ts`
- Modify: `warehouse-server/src/tests/departments.test.ts`

**Interfaces:**
- Consumes: the pricing columns from Task 2.
- Produces: `PUT /api/departments/:id` accepts optional `price_per_archived_box`/`price_per_retrieved_box`/`price_per_empty_carton`. `GET /api/departments` and `GET /api/companies/:id` (its `DEPARTMENTS` array) now include these three fields on every department row — consumed by Task 5's frontend.

- [ ] **Step 1: Modify `warehouse-server/src/schemas/departmentSchemas.ts`**

Change `updateDepartmentSchema` from:

```typescript
export const updateDepartmentSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(32).optional(),
    status: z.enum(['active', 'inactive']).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });
```

to:

```typescript
export const updateDepartmentSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(32).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    price_per_archived_box: z.number().nonnegative().optional(),
    price_per_retrieved_box: z.number().nonnegative().optional(),
    price_per_empty_carton: z.number().nonnegative().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });
```

(`updateDepartment`'s controller code needs no change — it already builds its `SET` clause dynamically from whatever validated fields are present.)

- [ ] **Step 2: Modify `warehouse-server/src/controllers/departmentController.ts`'s `getDepartments`**

Change the SELECT list from:

```typescript
            SELECT d.id, d.company_id, d.warehouse_id, d.name, d.code, d.status, d.current_box_count,
                   w.name AS warehouse_name
```

to:

```typescript
            SELECT d.id, d.company_id, d.warehouse_id, d.name, d.code, d.status, d.current_box_count,
                   d.price_per_archived_box, d.price_per_retrieved_box, d.price_per_empty_carton,
                   w.name AS warehouse_name
```

- [ ] **Step 3: Modify `warehouse-server/src/controllers/companyController.ts`'s `getCompanyById`**

Change the `deptResult` query from:

```typescript
        const deptResult = await execute<any>(
            `SELECT d.id, d.name, d.code, d.status, d.current_box_count, d.warehouse_id, w.name AS warehouse_name
             FROM departments d
             JOIN warehouses w ON w.id = d.warehouse_id
             WHERE d.company_id = :id
             ORDER BY d.name`,
            [req.params.id]
        );
```

to:

```typescript
        const deptResult = await execute<any>(
            `SELECT d.id, d.name, d.code, d.status, d.current_box_count, d.warehouse_id, w.name AS warehouse_name,
                    d.price_per_archived_box, d.price_per_retrieved_box, d.price_per_empty_carton
             FROM departments d
             JOIN warehouses w ON w.id = d.warehouse_id
             WHERE d.company_id = :id
             ORDER BY d.name`,
            [req.params.id]
        );
```

- [ ] **Step 4: Add a test to `warehouse-server/src/tests/departments.test.ts`**

Add this case inside the existing `describe('Departments API', ...)` block, alongside the other tests:

```typescript
    it('PUT /api/departments/:id accepts pricing fields', async () => {
        mockExecute.mockResolvedValueOnce({
            rows: [{ ID: 1, PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20 }],
        });

        const res = await request(app).put('/api/departments/1').send({
            price_per_archived_box: 50,
            price_per_retrieved_box: 45,
            price_per_empty_carton: 20,
        });

        expect(res.status).toBe(200);
        expect(res.body.PRICE_PER_ARCHIVED_BOX).toBe(50);
    });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd warehouse-server && npm test`
Expected: PASS across all suites — the existing `GET filters by company_id` test's regex assertion (`/AND d\.company_id = :company_id/`) still matches since it only checks for that substring, unaffected by the added SELECT columns.

- [ ] **Step 6: Commit**

```bash
git add warehouse-server/src/schemas/departmentSchemas.ts warehouse-server/src/controllers/departmentController.ts warehouse-server/src/controllers/companyController.ts warehouse-server/src/tests/departments.test.ts
git commit -m "feat(warehouse-server): expose and allow updating department box pricing"
```

---

## Task 4: Backend — Invoice API (preview, save, list, delete)

**Files:**
- Create: `warehouse-server/src/schemas/invoiceSchemas.ts`
- Create: `warehouse-server/src/controllers/invoiceController.ts`
- Create: `warehouse-server/src/routes/invoiceRoutes.ts`
- Modify: `warehouse-server/src/app.ts` (mount `/api/invoices`)
- Test: `warehouse-server/src/tests/invoices.test.ts`

**Interfaces:**
- Consumes: `execute` (`db/dbUtils.ts`), `computeInvoiceAmounts` (Task 1), `authenticateToken`/`requireRole` (`middleware/authMiddleware.ts`), `validateBody`/`validateQuery` (`middleware/validationMiddleware.ts`).
- Produces: `POST /api/invoices/preview` → breakdown object (UPPERCASE keys: `DEPARTMENT_ID, COMPANY_ID, DEPARTMENT_NAME, COMPANY_NAME, PERIOD_FROM, PERIOD_TO, ARCHIVED_COUNT, RETRIEVED_COUNT, EMPTY_CARTON_COUNT, PRICE_PER_ARCHIVED_BOX, PRICE_PER_RETRIEVED_BOX, PRICE_PER_EMPTY_CARTON, SUBTOTAL, SSCL_AMOUNT, VAT_AMOUNT, TOTAL_AMOUNT`), not persisted. `POST /api/invoices` → same shape plus `ID`/`CREATED_AT`/`CREATED_BY`, persisted. `GET /api/invoices`, `DELETE /api/invoices/:id`. Every route admin-only. Consumed by Task 6's frontend.

- [ ] **Step 1: Create `warehouse-server/src/schemas/invoiceSchemas.ts`**

```typescript
import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');

export const invoicePeriodSchema = z.object({
    department_id: z.number().int().positive(),
    period_from: dateStr,
    period_to: dateStr,
});

export const invoiceQuerySchema = z.object({
    department_id: z.string().optional(),
    company_id: z.string().optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
});
```

- [ ] **Step 2: Create `warehouse-server/src/controllers/invoiceController.ts`**

```typescript
import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';
import { computeInvoiceAmounts } from '../utils/invoiceCalc';

const SSCL_RATE = parseFloat(process.env.SSCL_RATE || '0.025641');
const VAT_RATE = parseFloat(process.env.VAT_RATE || '0.18');

async function computeBreakdown(department_id: number, period_from: string, period_to: string) {
    const deptResult = await execute<any>(
        `SELECT d.id, d.company_id, d.name AS department_name, c.name AS company_name,
                d.price_per_archived_box, d.price_per_retrieved_box, d.price_per_empty_carton
         FROM departments d
         JOIN companies c ON c.id = d.company_id
         WHERE d.id = :department_id`,
        { department_id }
    );
    if (deptResult.rows.length === 0) {
        return null;
    }
    const dept = deptResult.rows[0];

    const countsResult = await execute<any>(
        `SELECT event_type, COALESCE(SUM(quantity), 0)::int AS total
         FROM box_events
         WHERE department_id = :department_id AND event_date >= :period_from AND event_date <= :period_to
         GROUP BY event_type`,
        { department_id, period_from, period_to }
    );
    const counts: Record<string, number> = { archived: 0, retrieved: 0, empty_carton_issued: 0 };
    for (const row of countsResult.rows) {
        counts[row.EVENT_TYPE] = row.TOTAL;
    }

    const amounts = computeInvoiceAmounts(
        counts.archived,
        counts.retrieved,
        counts.empty_carton_issued,
        {
            archived: dept.PRICE_PER_ARCHIVED_BOX,
            retrieved: dept.PRICE_PER_RETRIEVED_BOX,
            emptyCarton: dept.PRICE_PER_EMPTY_CARTON,
        },
        SSCL_RATE,
        VAT_RATE
    );

    return {
        DEPARTMENT_ID: dept.ID,
        COMPANY_ID: dept.COMPANY_ID,
        DEPARTMENT_NAME: dept.DEPARTMENT_NAME,
        COMPANY_NAME: dept.COMPANY_NAME,
        PERIOD_FROM: period_from,
        PERIOD_TO: period_to,
        ARCHIVED_COUNT: counts.archived,
        RETRIEVED_COUNT: counts.retrieved,
        EMPTY_CARTON_COUNT: counts.empty_carton_issued,
        PRICE_PER_ARCHIVED_BOX: dept.PRICE_PER_ARCHIVED_BOX,
        PRICE_PER_RETRIEVED_BOX: dept.PRICE_PER_RETRIEVED_BOX,
        PRICE_PER_EMPTY_CARTON: dept.PRICE_PER_EMPTY_CARTON,
        SUBTOTAL: amounts.subtotal,
        SSCL_AMOUNT: amounts.ssclAmount,
        VAT_AMOUNT: amounts.vatAmount,
        TOTAL_AMOUNT: amounts.totalAmount,
    };
}

export const previewInvoice = async (req: Request, res: Response) => {
    const { department_id, period_from, period_to } = req.body;
    try {
        const breakdown = await computeBreakdown(department_id, period_from, period_to);
        if (!breakdown) {
            return res.status(404).json({ message: 'Department not found' });
        }
        res.json(breakdown);
    } catch (err) {
        console.error('previewInvoice error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const createInvoice = async (req: Request, res: Response) => {
    const { department_id, period_from, period_to } = req.body;
    const userId = (req as any).user?.id ?? null;
    try {
        const breakdown = await computeBreakdown(department_id, period_from, period_to);
        if (!breakdown) {
            return res.status(404).json({ message: 'Department not found' });
        }

        const result = await execute<any>(
            `INSERT INTO invoices (
                department_id, company_id, department_name, company_name,
                period_from, period_to, archived_count, retrieved_count, empty_carton_count,
                price_per_archived_box, price_per_retrieved_box, price_per_empty_carton,
                subtotal, sscl_amount, vat_amount, total_amount, created_by
            ) VALUES (
                :department_id, :company_id, :department_name, :company_name,
                :period_from, :period_to, :archived_count, :retrieved_count, :empty_carton_count,
                :price_per_archived_box, :price_per_retrieved_box, :price_per_empty_carton,
                :subtotal, :sscl_amount, :vat_amount, :total_amount, :created_by
            ) RETURNING *`,
            {
                department_id: breakdown.DEPARTMENT_ID,
                company_id: breakdown.COMPANY_ID,
                department_name: breakdown.DEPARTMENT_NAME,
                company_name: breakdown.COMPANY_NAME,
                period_from: breakdown.PERIOD_FROM,
                period_to: breakdown.PERIOD_TO,
                archived_count: breakdown.ARCHIVED_COUNT,
                retrieved_count: breakdown.RETRIEVED_COUNT,
                empty_carton_count: breakdown.EMPTY_CARTON_COUNT,
                price_per_archived_box: breakdown.PRICE_PER_ARCHIVED_BOX,
                price_per_retrieved_box: breakdown.PRICE_PER_RETRIEVED_BOX,
                price_per_empty_carton: breakdown.PRICE_PER_EMPTY_CARTON,
                subtotal: breakdown.SUBTOTAL,
                sscl_amount: breakdown.SSCL_AMOUNT,
                vat_amount: breakdown.VAT_AMOUNT,
                total_amount: breakdown.TOTAL_AMOUNT,
                created_by: userId,
            }
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('createInvoice error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const getInvoices = async (req: Request, res: Response) => {
    const { department_id, company_id, from, to } = req.query;
    try {
        let query = `SELECT * FROM invoices WHERE 1=1`;
        const params: any = {};
        if (department_id) { query += ` AND department_id = :department_id`; params.department_id = department_id; }
        if (company_id) { query += ` AND company_id = :company_id`; params.company_id = company_id; }
        if (from) { query += ` AND period_from >= :from`; params.from = from; }
        if (to) { query += ` AND period_to <= :to`; params.to = to; }
        query += ` ORDER BY created_at DESC`;
        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getInvoices error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

export const deleteInvoice = async (req: Request, res: Response) => {
    try {
        const result = await execute<any>(`DELETE FROM invoices WHERE id = :id RETURNING id`, [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Invoice not found' });
        }
        res.json({ message: 'Invoice deleted' });
    } catch (err) {
        console.error('deleteInvoice error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
```

- [ ] **Step 3: Create `warehouse-server/src/routes/invoiceRoutes.ts`**

```typescript
import { Router } from 'express';
import { previewInvoice, createInvoice, getInvoices, deleteInvoice } from '../controllers/invoiceController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { validateBody, validateQuery } from '../middleware/validationMiddleware';
import { invoicePeriodSchema, invoiceQuerySchema } from '../schemas/invoiceSchemas';

const router = Router();

router.use(authenticateToken);
router.use(requireRole(['admin']));

router.get('/', validateQuery(invoiceQuerySchema), getInvoices);
router.post('/preview', validateBody(invoicePeriodSchema), previewInvoice);
router.post('/', validateBody(invoicePeriodSchema), createInvoice);
router.delete('/:id', deleteInvoice);

export default router;
```

- [ ] **Step 4: Modify `warehouse-server/src/app.ts` to mount invoice routes**

Add import alongside the other route imports:

```typescript
import invoiceRoutes from './routes/invoiceRoutes';
```

Add alongside the other `app.use('/api/...', ...)` lines:

```typescript
app.use('/api/invoices', invoiceRoutes);
```

- [ ] **Step 5: Write the failing test — `warehouse-server/src/tests/invoices.test.ts`**

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

import invoiceRoutes from '../routes/invoiceRoutes';
import { execute } from '../db/dbUtils';

const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/invoices', invoiceRoutes);

const VALID_BODY = { department_id: 1, period_from: '2026-07-01', period_to: '2026-07-31' };

const DEPT_ROW = {
    ID: 1, COMPANY_ID: 1, DEPARTMENT_NAME: 'CASH DEPT', COMPANY_NAME: 'AB Securitas',
    PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20,
};

describe('POST /api/invoices/preview', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('computes a full breakdown without persisting anything', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [DEPT_ROW] })
            .mockResolvedValueOnce({ rows: [{ EVENT_TYPE: 'archived', TOTAL: 100 }, { EVENT_TYPE: 'retrieved', TOTAL: 20 }] });

        const res = await request(app).post('/api/invoices/preview').send(VALID_BODY);

        expect(res.status).toBe(200);
        expect(res.body.SUBTOTAL).toBe(5900); // 100*50 + 20*45
        expect(res.body.TOTAL_AMOUNT).toBeGreaterThan(res.body.SUBTOTAL);
        expect(mockExecute).toHaveBeenCalledTimes(2); // no INSERT
    });

    it('returns 404 when the department does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).post('/api/invoices/preview').send(VALID_BODY);

        expect(res.status).toBe(404);
    });

    it('rejects a body missing period_from', async () => {
        const res = await request(app).post('/api/invoices/preview').send({ department_id: 1, period_to: '2026-07-31' });

        expect(res.status).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});

describe('POST /api/invoices', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('recomputes and saves an invoice, ignoring any client-submitted amounts', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [DEPT_ROW] })
            .mockResolvedValueOnce({ rows: [{ EVENT_TYPE: 'archived', TOTAL: 100 }, { EVENT_TYPE: 'retrieved', TOTAL: 20 }] })
            .mockResolvedValueOnce({ rows: [{ ID: 1, DEPARTMENT_ID: 1, SUBTOTAL: 5900, TOTAL_AMOUNT: 7139.15 }] });

        const res = await request(app).post('/api/invoices').send({ ...VALID_BODY, total_amount: 1 });

        expect(res.status).toBe(201);
        expect(res.body.ID).toBe(1);
        const insertCall = mockExecute.mock.calls[2];
        expect(insertCall[0]).toMatch(/INSERT INTO invoices/);
        expect(insertCall[1].subtotal).toBe(5900); // server-recomputed, not the submitted "1"
    });

    it('returns 404 when the department does not exist', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).post('/api/invoices').send(VALID_BODY);

        expect(res.status).toBe(404);
    });
});

describe('GET /api/invoices', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('filters by department_id', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).get('/api/invoices?department_id=1');

        expect(res.status).toBe(200);
        expect(mockExecute.mock.calls[0][0]).toMatch(/AND department_id = :department_id/);
    });
});

describe('DELETE /api/invoices/:id', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('deletes an invoice', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1 }] });

        const res = await request(app).delete('/api/invoices/1');

        expect(res.status).toBe(200);
    });

    it('returns 404 when missing', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });

        const res = await request(app).delete('/api/invoices/999');

        expect(res.status).toBe(404);
    });
});

describe('Invoices API — admin-only gating on every route including reads (real requireRole)', () => {
    const { requireRole: realRequireRole } = jest.requireActual('../middleware/authMiddleware');

    beforeEach(() => { mockExecute.mockReset(); });

    it('GET /api/invoices returns 403 for a non-admin user', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 1, role: 'staff' };
                next();
            },
            requireRole: realRequireRole,
        }));
        jest.doMock('../db/dbUtils', () => ({ execute: mockExecute }));

        const staffRoutes = require('../routes/invoiceRoutes').default;
        const staffApp = express();
        staffApp.use(express.json());
        staffApp.use('/api/invoices', staffRoutes);

        const res = await request(staffApp).get('/api/invoices');

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
Expected: PASS, including all `Invoices API` cases, with no regressions.

- [ ] **Step 7: Commit**

```bash
git add warehouse-server/src/schemas/invoiceSchemas.ts warehouse-server/src/controllers/invoiceController.ts warehouse-server/src/routes/invoiceRoutes.ts warehouse-server/src/app.ts warehouse-server/src/tests/invoices.test.ts
git commit -m "feat(warehouse-server): add invoice preview/save/list/delete API"
```

---

## Task 5: Frontend — types + Company Detail inline price edit

**Files:**
- Modify: `warehouse-client/src/types.ts`
- Modify: `warehouse-client/src/pages/CompanyDetail.tsx`

**Interfaces:**
- Consumes: the pricing fields now returned by `GET /companies/:id` (Task 3).
- Produces: `PRICE_PER_ARCHIVED_BOX`/`PRICE_PER_RETRIEVED_BOX`/`PRICE_PER_EMPTY_CARTON` added to the `Department` type, and `InvoiceBreakdown`/`Invoice` types — consumed by Task 6.

- [ ] **Step 1: Modify `warehouse-client/src/types.ts`**

Change the `Department` interface from:

```typescript
export interface Department {
    ID: number;
    COMPANY_ID: number;
    WAREHOUSE_ID: number;
    WAREHOUSE_NAME?: string;
    NAME: string;
    CODE: string | null;
    STATUS: 'active' | 'inactive';
    CURRENT_BOX_COUNT: number;
}
```

to:

```typescript
export interface Department {
    ID: number;
    COMPANY_ID: number;
    WAREHOUSE_ID: number;
    WAREHOUSE_NAME?: string;
    NAME: string;
    CODE: string | null;
    STATUS: 'active' | 'inactive';
    CURRENT_BOX_COUNT: number;
    PRICE_PER_ARCHIVED_BOX: number;
    PRICE_PER_RETRIEVED_BOX: number;
    PRICE_PER_EMPTY_CARTON: number;
}
```

Add these two interfaces after `Department` (Task 6 will consume them):

```typescript
export interface InvoiceBreakdown {
    DEPARTMENT_ID: number;
    COMPANY_ID: number;
    DEPARTMENT_NAME: string;
    COMPANY_NAME: string;
    PERIOD_FROM: string;
    PERIOD_TO: string;
    ARCHIVED_COUNT: number;
    RETRIEVED_COUNT: number;
    EMPTY_CARTON_COUNT: number;
    PRICE_PER_ARCHIVED_BOX: number;
    PRICE_PER_RETRIEVED_BOX: number;
    PRICE_PER_EMPTY_CARTON: number;
    SUBTOTAL: number;
    SSCL_AMOUNT: number;
    VAT_AMOUNT: number;
    TOTAL_AMOUNT: number;
}

export interface Invoice extends InvoiceBreakdown {
    ID: number;
    CREATED_AT: string;
    CREATED_BY: number | null;
}
```

- [ ] **Step 2: Replace `warehouse-client/src/pages/CompanyDetail.tsx` with the following**

```tsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Pencil, Check, X } from 'lucide-react';
import api from '../services/api';
import type { Company, Warehouse, Department } from '../types';

const CompanyDetail: React.FC = () => {
    const { id } = useParams();
    const [company, setCompany] = useState<Company | null>(null);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [deptName, setDeptName] = useState('');
    const [deptCode, setDeptCode] = useState('');
    const [deptWarehouseId, setDeptWarehouseId] = useState('');

    const [editingDeptId, setEditingDeptId] = useState<number | null>(null);
    const [editArchivedPrice, setEditArchivedPrice] = useState('');
    const [editRetrievedPrice, setEditRetrievedPrice] = useState('');
    const [editEmptyCartonPrice, setEditEmptyCartonPrice] = useState('');

    const load = () => {
        setLoading(true);
        Promise.all([
            api.get<Company>(`/companies/${id}`),
            api.get<Warehouse[]>('/warehouses'),
        ]).then(([companyRes, warehousesRes]) => {
            setCompany(companyRes.data);
            setWarehouses(warehousesRes.data);
        }).finally(() => setLoading(false));
    };

    useEffect(load, [id]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/departments', {
                company_id: Number(id),
                warehouse_id: Number(deptWarehouseId),
                name: deptName,
                code: deptCode || undefined,
            });
            toast.success('Department created');
            setDeptName('');
            setDeptCode('');
            setDeptWarehouseId('');
            setShowForm(false);
            load();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to create department');
        }
    };

    const startEditDept = (d: Department) => {
        setEditingDeptId(d.ID);
        setEditArchivedPrice(String(d.PRICE_PER_ARCHIVED_BOX ?? 0));
        setEditRetrievedPrice(String(d.PRICE_PER_RETRIEVED_BOX ?? 0));
        setEditEmptyCartonPrice(String(d.PRICE_PER_EMPTY_CARTON ?? 0));
    };

    const cancelEditDept = () => setEditingDeptId(null);

    const saveEditDept = async (deptId: number) => {
        try {
            await api.put(`/departments/${deptId}`, {
                price_per_archived_box: Number(editArchivedPrice),
                price_per_retrieved_box: Number(editRetrievedPrice),
                price_per_empty_carton: Number(editEmptyCartonPrice),
            });
            toast.success('Pricing updated');
            setEditingDeptId(null);
            load();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update pricing');
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
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">Warehouse</label>
                        <select className="border border-slate-300 rounded-lg px-3 py-2" value={deptWarehouseId} onChange={(e) => setDeptWarehouseId(e.target.value)} required>
                            <option value="">Select...</option>
                            {warehouses.map((w) => (
                                <option key={w.ID} value={w.ID}>{w.NAME}</option>
                            ))}
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
                            <th className="p-3">Name</th>
                            <th className="p-3">Code</th>
                            <th className="p-3">Warehouse</th>
                            <th className="p-3">Current Box Count</th>
                            <th className="p-3">Price/Archived</th>
                            <th className="p-3">Price/Retrieved</th>
                            <th className="p-3">Price/Empty Carton</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(company.DEPARTMENTS || []).map((d) =>
                            editingDeptId === d.ID ? (
                                <tr key={d.ID} className="border-t border-slate-100 bg-slate-50">
                                    <td className="p-3">{d.NAME}</td>
                                    <td className="p-3">{d.CODE}</td>
                                    <td className="p-3">{d.WAREHOUSE_NAME}</td>
                                    <td className="p-3">{d.CURRENT_BOX_COUNT}</td>
                                    <td className="p-2">
                                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editArchivedPrice} onChange={(e) => setEditArchivedPrice(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editRetrievedPrice} onChange={(e) => setEditRetrievedPrice(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editEmptyCartonPrice} onChange={(e) => setEditEmptyCartonPrice(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <div className="flex gap-2">
                                            <button onClick={() => saveEditDept(d.ID)} className="text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                                            <button onClick={cancelEditDept} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={d.ID} className="border-t border-slate-100">
                                    <td className="p-3">{d.NAME}</td>
                                    <td className="p-3">{d.CODE}</td>
                                    <td className="p-3">{d.WAREHOUSE_NAME}</td>
                                    <td className="p-3">{d.CURRENT_BOX_COUNT}</td>
                                    <td className="p-3">{d.PRICE_PER_ARCHIVED_BOX}</td>
                                    <td className="p-3">{d.PRICE_PER_RETRIEVED_BOX}</td>
                                    <td className="p-3">{d.PRICE_PER_EMPTY_CARTON}</td>
                                    <td className="p-3">
                                        <button onClick={() => startEditDept(d)} className="text-slate-500 hover:text-blue-600" title="Edit"><Pencil size={16} /></button>
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

export default CompanyDetail;
```

Note: like the existing "New Department" button on this same page, the pricing edit button is not role-gated in the UI (only the backend enforces admin-only via `requireRole`) — this matches the page's own existing convention rather than introducing a new one.

- [ ] **Step 3: Verify the build**

Run: `cd warehouse-client && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add warehouse-client/src/types.ts warehouse-client/src/pages/CompanyDetail.tsx
git commit -m "feat(warehouse-client): add department pricing types and inline price editing"
```

---

## Task 6: Frontend — Invoices page + nav

**Files:**
- Create: `warehouse-client/src/pages/Invoices.tsx`
- Modify: `warehouse-client/src/App.tsx` (add `/invoices` route)
- Modify: `warehouse-client/src/components/Layout.tsx` (add admin-only nav item)

**Interfaces:**
- Consumes: `InvoiceBreakdown`/`Invoice` types (Task 5), `POST /invoices/preview`, `POST /invoices`, `GET /invoices`, `DELETE /invoices/:id` (Task 4), `useAuth`.

- [ ] **Step 1: Create `warehouse-client/src/pages/Invoices.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Company, Department, Invoice, InvoiceBreakdown } from '../types';

const Invoices: React.FC = () => {
    const { user } = useAuth();
    const isAdmin = user?.ROLE === 'admin';

    const [companies, setCompanies] = useState<Company[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(isAdmin);

    const [companyId, setCompanyId] = useState('');
    const [departmentId, setDepartmentId] = useState('');
    const [periodFrom, setPeriodFrom] = useState('');
    const [periodTo, setPeriodTo] = useState('');
    const [preview, setPreview] = useState<InvoiceBreakdown | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadInvoices = () => {
        api.get<Invoice[]>('/invoices').then((res) => setInvoices(res.data));
    };

    useEffect(() => {
        if (!isAdmin) return;
        Promise.all([
            api.get<Company[]>('/companies'),
            api.get<Invoice[]>('/invoices'),
        ]).then(([companiesRes, invoicesRes]) => {
            setCompanies(companiesRes.data);
            setInvoices(invoicesRes.data);
        }).finally(() => setLoading(false));
    }, [isAdmin]);

    const loadDepartments = (forCompanyId: string) => {
        if (!forCompanyId) {
            setDepartments([]);
            return;
        }
        api.get<Department[]>('/departments', { params: { company_id: forCompanyId } })
            .then((res) => setDepartments(res.data));
    };

    useEffect(() => {
        loadDepartments(companyId);
    }, [companyId]);

    const handlePreview = async () => {
        setPreviewing(true);
        setPreview(null);
        try {
            const res = await api.post<InvoiceBreakdown>('/invoices/preview', {
                department_id: Number(departmentId),
                period_from: periodFrom,
                period_to: periodTo,
            });
            setPreview(res.data);
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to generate preview');
        } finally {
            setPreviewing(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.post('/invoices', {
                department_id: Number(departmentId),
                period_from: periodFrom,
                period_to: periodTo,
            });
            toast.success('Invoice saved');
            setPreview(null);
            loadInvoices();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to save invoice');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm('Delete this invoice?')) return;
        try {
            await api.delete(`/invoices/${id}`);
            toast.success('Invoice deleted');
            loadInvoices();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to delete invoice');
        }
    };

    if (!isAdmin) return <div className="text-slate-500">You don't have access to this page.</div>;
    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Invoices</h1>

            <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-5 gap-3 items-end">
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Company</label>
                    <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setDepartmentId(''); setPreview(null); }}>
                        <option value="">Select...</option>
                        {companies.map((c) => (
                            <option key={c.ID} value={c.ID}>{c.NAME}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Department</label>
                    <select className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPreview(null); }} disabled={!companyId}>
                        <option value="">Select...</option>
                        {departments.map((d) => (
                            <option key={d.ID} value={d.ID}>{d.NAME}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Period From</label>
                    <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Period To</label>
                    <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
                </div>
                <button
                    onClick={handlePreview}
                    disabled={!departmentId || !periodFrom || !periodTo || previewing}
                    className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                    {previewing ? 'Loading...' : 'Preview'}
                </button>
            </div>

            {preview && (
                <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                    <h2 className="text-lg font-semibold text-slate-700">{preview.DEPARTMENT_NAME} — {preview.COMPANY_NAME}</h2>
                    <div className="text-sm text-slate-500">{preview.PERIOD_FROM} to {preview.PERIOD_TO}</div>
                    <table className="w-full text-sm">
                        <tbody>
                            <tr className="border-t border-slate-100">
                                <td className="p-2">Archived boxes</td>
                                <td className="p-2">{preview.ARCHIVED_COUNT} × {preview.PRICE_PER_ARCHIVED_BOX}</td>
                            </tr>
                            <tr className="border-t border-slate-100">
                                <td className="p-2">Retrieved boxes</td>
                                <td className="p-2">{preview.RETRIEVED_COUNT} × {preview.PRICE_PER_RETRIEVED_BOX}</td>
                            </tr>
                            <tr className="border-t border-slate-100">
                                <td className="p-2">Empty cartons</td>
                                <td className="p-2">{preview.EMPTY_CARTON_COUNT} × {preview.PRICE_PER_EMPTY_CARTON}</td>
                            </tr>
                            <tr className="border-t border-slate-200 font-medium">
                                <td className="p-2">Subtotal</td>
                                <td className="p-2">{preview.SUBTOTAL}</td>
                            </tr>
                            <tr className="border-t border-slate-100">
                                <td className="p-2">SSCL</td>
                                <td className="p-2">{preview.SSCL_AMOUNT}</td>
                            </tr>
                            <tr className="border-t border-slate-100">
                                <td className="p-2">VAT</td>
                                <td className="p-2">{preview.VAT_AMOUNT}</td>
                            </tr>
                            <tr className="border-t border-slate-200 font-bold">
                                <td className="p-2">Total</td>
                                <td className="p-2">{preview.TOTAL_AMOUNT}</td>
                            </tr>
                        </tbody>
                    </table>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save Invoice'}
                    </button>
                </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200">
                <div className="p-4 border-b border-slate-200 font-semibold text-slate-700">Saved Invoices</div>
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Period</th>
                            <th className="p-3">Company</th>
                            <th className="p-3">Department</th>
                            <th className="p-3">Total</th>
                            <th className="p-3">Saved</th>
                            <th className="p-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoices.map((inv) => (
                            <tr key={inv.ID} className="border-t border-slate-100">
                                <td className="p-3">{inv.PERIOD_FROM} to {inv.PERIOD_TO}</td>
                                <td className="p-3">{inv.COMPANY_NAME}</td>
                                <td className="p-3">{inv.DEPARTMENT_NAME}</td>
                                <td className="p-3">{inv.TOTAL_AMOUNT}</td>
                                <td className="p-3">{inv.CREATED_AT}</td>
                                <td className="p-3">
                                    <button onClick={() => handleDelete(inv.ID)} className="text-red-600 hover:text-red-700 text-xs font-medium">Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Invoices;
```

- [ ] **Step 2: Modify `warehouse-client/src/App.tsx` to add the route**

Add import:

```tsx
import Invoices from './pages/Invoices';
```

Add inside the `<Route path="/" element={...}>` block, alongside the other routes:

```tsx
<Route path="invoices" element={<Invoices />} />
```

- [ ] **Step 3: Modify `warehouse-client/src/components/Layout.tsx` to add the nav item**

Change the import line from:

```tsx
import { LayoutDashboard, Building2, Warehouse, PackageSearch, BarChart3, Users, LogOut, KeyRound } from 'lucide-react';
```

to:

```tsx
import { LayoutDashboard, Building2, Warehouse, PackageSearch, BarChart3, Users, Receipt, LogOut, KeyRound } from 'lucide-react';
```

Change `ADMIN_NAV_ITEMS` from:

```tsx
const ADMIN_NAV_ITEMS = [
    { to: '/users', label: 'Users', icon: Users },
];
```

to:

```tsx
const ADMIN_NAV_ITEMS = [
    { to: '/users', label: 'Users', icon: Users },
    { to: '/invoices', label: 'Invoices', icon: Receipt },
];
```

- [ ] **Step 4: Verify the build**

Run: `cd warehouse-client && npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add warehouse-client/src/pages/Invoices.tsx warehouse-client/src/App.tsx warehouse-client/src/components/Layout.tsx
git commit -m "feat(warehouse-client): add invoices page with preview/save/history"
```

---

## Task 7: Manual end-to-end verification

**Files:** None (verification only).

- [ ] **Step 1: Start the stack**

With PostgreSQL reachable and `.env` configured (copy the new `SSCL_RATE`/`VAT_RATE` lines from `.env.example` into `.env` if not already present — defaults apply even if omitted):

```bash
cd warehouse-server && npm run dev
cd warehouse-client && npm run dev
```

- [ ] **Step 2: Walk the golden path**

1. Log in as `admin` / `password123`.
2. Go to a company's detail page (create one with a department if needed, via a warehouse that already exists).
3. Edit the department's pricing: set Price/Archived = 50, Price/Retrieved = 45, Price/Empty Carton = 20. Save — confirm the values persist after a page reload.
4. Log a few box events for that department via the Box Events page (e.g. archive 100, retrieve 20) if none exist yet for the period you'll invoice.
5. Go to Invoices, select the company and department, pick a date range covering those events, click Preview — confirm the breakdown shows the correct counts, the prices you set, and a total that includes SSCL then VAT on top of the subtotal.
6. Click Save Invoice — confirm it appears in the Saved Invoices history table below.
7. Confirm `GET /api/invoices` and the Invoices page are inaccessible to a non-admin: as a `staff` user, confirm the "Invoices" nav item is hidden and navigating directly to `/invoices` shows "You don't have access to this page." (not a broken fetch).
8. Delete the saved invoice from the history table — confirm it disappears.

- [ ] **Step 3: Report results**

If everything in Step 2 passes, this task is complete — no commit (verification only). If anything fails, fix it under the relevant earlier task and re-verify.
