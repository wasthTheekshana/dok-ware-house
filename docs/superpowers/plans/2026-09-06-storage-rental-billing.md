# Storage Rental Auto-Calculation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a monthly storage-rental line item to invoices, computed as `current_box_count × price_per_box_stored_monthly` on the department, satisfying SRS FR-11.

**Architecture:** Extend the existing per-department rate-card model (which already has `price_per_archived_box`/`price_per_retrieved_box`/`price_per_empty_carton`) with a fourth price field, and extend the existing invoice computation/persistence/reversal pipeline (already built for the other three line items) with a fourth term. No new tables, no new entities — this reuses every pattern already in the codebase.

**Tech Stack:** Node.js/Express/TypeScript backend, PostgreSQL (`pg`, named-parameter SQL via `execute`), React/TypeScript/Vite frontend, Jest + Supertest for backend tests.

**Spec:** `docs/superpowers/specs/2026-09-06-storage-rental-billing-design.md`

## Global Constraints

- Rental basis is the **live** `departments.current_box_count` at invoice-generation time — never a historical reconstruction from `box_events`.
- Rental is a **flat monthly charge**, never prorated by period length.
- New department price field defaults to `0` — no existing department starts charging rent until explicitly configured.
- `invoices.storage_rental_amount` is a real monetary line (included in `subtotal`, negated on reversal like every other monetary field). `invoices.box_count_at_billing` is an informational snapshot only — copied unchanged (never negated) on reversal.
- All new SQL migrations follow this codebase's established idempotent pattern: additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, safe to run in any order, no data migration needed since the default (`0`) is correct for every pre-existing row.
- Department/company pricing fields (including the new one) must stay hidden from roles without pricing visibility (`canSeePricing`: `system_admin`/`finance_officer` only) in both `GET /departments` and `GET /companies/:id`.

---

### Task 1: Add storage rental term to `computeInvoiceAmounts`

**Files:**
- Modify: `warehouse-server/src/utils/invoiceCalc.ts`
- Test: `warehouse-server/src/tests/invoiceCalc.test.ts`

**Interfaces:**
- Produces: `computeInvoiceAmounts(archivedCount: number, retrievedCount: number, emptyCartonCount: number, boxesStoredCount: number, prices: InvoicePrices, ssclRate: number, vatRate: number): InvoiceAmounts` where `InvoicePrices` now has a 4th field `storedMonthly: number`. This new signature (4th positional count parameter inserted before `prices`, plus the new `prices.storedMonthly` field) is what Task 4 (`invoiceController.ts`) calls.

The current file is:

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

- [ ] **Step 1: Replace the test file with the updated signature (existing tests) plus new rental tests**

Replace the full contents of `warehouse-server/src/tests/invoiceCalc.test.ts` with:

```typescript
/// <reference types="jest" />
import { computeInvoiceAmounts } from '../utils/invoiceCalc';

describe('computeInvoiceAmounts', () => {
    it('returns all zeros when counts are zero', () => {
        expect(computeInvoiceAmounts(0, 0, 0, 0, { archived: 50, retrieved: 45, emptyCarton: 20, storedMonthly: 10 }, 0.025641, 0.18))
            .toEqual({ subtotal: 0, ssclAmount: 0, vatAmount: 0, totalAmount: 0 });
    });

    it('returns all zeros when prices are zero, regardless of counts', () => {
        expect(computeInvoiceAmounts(100, 20, 5, 200, { archived: 0, retrieved: 0, emptyCarton: 0, storedMonthly: 0 }, 0.025641, 0.18))
            .toEqual({ subtotal: 0, ssclAmount: 0, vatAmount: 0, totalAmount: 0 });
    });

    it('computes subtotal as the sum of each event type at its own price', () => {
        const result = computeInvoiceAmounts(100, 20, 5, 0, { archived: 50, retrieved: 45, emptyCarton: 20, storedMonthly: 0 }, 0.025641, 0.18);
        expect(result.subtotal).toBe(6000);
    });

    it('applies SSCL to the subtotal, then VAT to the SSCL-inclusive amount', () => {
        const result = computeInvoiceAmounts(100, 20, 5, 0, { archived: 50, retrieved: 45, emptyCarton: 20, storedMonthly: 0 }, 0.025641, 0.18);
        expect(result.ssclAmount).toBe(153.85);
        expect(result.vatAmount).toBe(1107.69);
        expect(result.totalAmount).toBe(7261.54);
    });

    it('rounds every amount to 2 decimal places', () => {
        const result = computeInvoiceAmounts(1, 0, 0, 0, { archived: 33.33, retrieved: 0, emptyCarton: 0, storedMonthly: 0 }, 0.025641, 0.18);
        expect(Number.isInteger(result.subtotal * 100)).toBe(true);
        expect(Number.isInteger(result.ssclAmount * 100)).toBe(true);
        expect(Number.isInteger(result.vatAmount * 100)).toBe(true);
        expect(Number.isInteger(result.totalAmount * 100)).toBe(true);
    });

    it('adds storage rental into the subtotal on its own', () => {
        const result = computeInvoiceAmounts(0, 0, 0, 200, { archived: 0, retrieved: 0, emptyCarton: 0, storedMonthly: 10 }, 0.025641, 0.18);
        expect(result.subtotal).toBe(2000);
    });

    it('combines storage rental with the other three line items in the same subtotal', () => {
        const result = computeInvoiceAmounts(100, 20, 5, 200, { archived: 50, retrieved: 45, emptyCarton: 20, storedMonthly: 10 }, 0.025641, 0.18);
        // 100*50 + 20*45 + 5*20 + 200*10 = 5000 + 900 + 100 + 2000 = 8000
        expect(result.subtotal).toBe(8000);
    });

    it('applies SSCL and VAT on top of the combined subtotal including rental', () => {
        const result = computeInvoiceAmounts(0, 0, 0, 100, { archived: 0, retrieved: 0, emptyCarton: 0, storedMonthly: 10 }, 0.025641, 0.18);
        // subtotal = 1000; ssclAmount = round2(1000*0.025641) = 25.64
        // vatAmount = round2((1000+25.64)*0.18) = round2(184.6152) = 184.62
        // totalAmount = round2(1000+25.64+184.62) = 1210.26
        expect(result.ssclAmount).toBe(25.64);
        expect(result.vatAmount).toBe(184.62);
        expect(result.totalAmount).toBe(1210.26);
    });
});
```

- [ ] **Step 2: Run the test file to verify it fails to compile / fails**

Run: `cd warehouse-server && npx jest src/tests/invoiceCalc.test.ts`
Expected: FAIL — TypeScript errors (`Expected 6-7 arguments, but got 5/6`, `Property 'storedMonthly' is missing`) since `invoiceCalc.ts` hasn't changed yet.

- [ ] **Step 3: Update `invoiceCalc.ts` to add the new parameter and term**

Replace the full contents of `warehouse-server/src/utils/invoiceCalc.ts` with:

```typescript
export interface InvoicePrices {
    archived: number;
    retrieved: number;
    emptyCarton: number;
    storedMonthly: number;
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
    boxesStoredCount: number,
    prices: InvoicePrices,
    ssclRate: number,
    vatRate: number
): InvoiceAmounts {
    const subtotal = round2(
        archivedCount * prices.archived +
        retrievedCount * prices.retrieved +
        emptyCartonCount * prices.emptyCarton +
        boxesStoredCount * prices.storedMonthly
    );
    const ssclAmount = round2(subtotal * ssclRate);
    const vatAmount = round2((subtotal + ssclAmount) * vatRate);
    const totalAmount = round2(subtotal + ssclAmount + vatAmount);
    return { subtotal, ssclAmount, vatAmount, totalAmount };
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `cd warehouse-server && npx jest src/tests/invoiceCalc.test.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Commit**

```bash
cd warehouse-server
git add src/utils/invoiceCalc.ts src/tests/invoiceCalc.test.ts
git commit -m "feat: add storage rental term to invoice amount calculation"
```

**Note for the implementer:** `invoiceController.ts` (a later task) still calls `computeInvoiceAmounts` with the OLD 6-argument signature. This will cause a TypeScript compile error in `invoiceController.ts` after this task alone — that is expected and is fixed in Task 4. Do not modify `invoiceController.ts` in this task; if `npx tsc --noEmit` is run project-wide it will show an error there, but the task's own test file (`invoiceCalc.test.ts`) is what must pass.

---

### Task 2: Database migration — new columns on `departments` and `invoices`

**Files:**
- Modify: `warehouse-server/src/db/config.ts`

**Interfaces:**
- Produces: `departments.price_per_box_stored_monthly` (NUMERIC(12,2) NOT NULL DEFAULT 0), `invoices.box_count_at_billing` (INTEGER NOT NULL DEFAULT 0), `invoices.storage_rental_amount` (NUMERIC(14,2) NOT NULL DEFAULT 0). Task 3 and Task 4 read/write these exact column names.

The current `departments` table block (lines 140–164) is:

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

        await client.query(`
            ALTER TABLE departments ADD COLUMN IF NOT EXISTS price_per_archived_box NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
        await client.query(`
            ALTER TABLE departments ADD COLUMN IF NOT EXISTS price_per_retrieved_box NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
        await client.query(`
            ALTER TABLE departments ADD COLUMN IF NOT EXISTS price_per_empty_carton NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
```

- [ ] **Step 1: Add `price_per_box_stored_monthly` to the departments block**

Find the block above in `warehouse-server/src/db/config.ts` and replace it with:

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
                price_per_box_stored_monthly NUMERIC(12,2) NOT NULL DEFAULT 0,
                created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (company_id, name)
            )
        `);

        await client.query(`
            ALTER TABLE departments ADD COLUMN IF NOT EXISTS price_per_archived_box NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
        await client.query(`
            ALTER TABLE departments ADD COLUMN IF NOT EXISTS price_per_retrieved_box NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
        await client.query(`
            ALTER TABLE departments ADD COLUMN IF NOT EXISTS price_per_empty_carton NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
        await client.query(`
            ALTER TABLE departments ADD COLUMN IF NOT EXISTS price_per_box_stored_monthly NUMERIC(12,2) NOT NULL DEFAULT 0
        `);
```

The current `invoices` table block is:

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
                created_by                INTEGER REFERENCES users(id),
                reverses_invoice_id       INTEGER REFERENCES invoices(id)
            )
        `);

        await client.query(`
            ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reverses_invoice_id INTEGER REFERENCES invoices(id)
        `);
```

- [ ] **Step 2: Add `box_count_at_billing` and `storage_rental_amount` to the invoices block**

Replace it with:

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
                box_count_at_billing      INTEGER NOT NULL DEFAULT 0,
                storage_rental_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
                subtotal                  NUMERIC(14,2) NOT NULL,
                sscl_amount               NUMERIC(14,2) NOT NULL,
                vat_amount                NUMERIC(14,2) NOT NULL,
                total_amount              NUMERIC(14,2) NOT NULL,
                created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
                created_by                INTEGER REFERENCES users(id),
                reverses_invoice_id       INTEGER REFERENCES invoices(id)
            )
        `);

        await client.query(`
            ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reverses_invoice_id INTEGER REFERENCES invoices(id)
        `);
        await client.query(`
            ALTER TABLE invoices ADD COLUMN IF NOT EXISTS box_count_at_billing INTEGER NOT NULL DEFAULT 0
        `);
        await client.query(`
            ALTER TABLE invoices ADD COLUMN IF NOT EXISTS storage_rental_amount NUMERIC(14,2) NOT NULL DEFAULT 0
        `);
```

- [ ] **Step 3: Boot the migration against the real database (twice, for idempotency)**

Run (from `warehouse-server/`), twice in a row:

```bash
npx ts-node -e "require('./src/db/config').initializeDb().then(()=>{console.log('INIT_OK');process.exit(0)}).catch((e)=>{console.error('INIT_FAIL',e);process.exit(1)})"
```

Expected both times: `INIT_OK` printed, exit code 0. This requires the `wh-postgres` Docker container to be running (`docker ps --filter name=wh-postgres`).

- [ ] **Step 4: Verify the schema live**

Run:
```bash
docker exec wh-postgres psql -U dokwarehouse -d dok_warehouse -c "\d departments"
docker exec wh-postgres psql -U dokwarehouse -d dok_warehouse -c "\d invoices"
```
Expected: `departments` shows `price_per_box_stored_monthly | numeric(12,2) | not null | 0`; `invoices` shows `box_count_at_billing | integer | not null | 0` and `storage_rental_amount | numeric(14,2) | not null | 0`.

- [ ] **Step 5: Commit**

```bash
cd warehouse-server
git add src/db/config.ts
git commit -m "feat: add storage rental columns to departments and invoices"
```

---

### Task 3: Expose `price_per_box_stored_monthly` through department and company pricing endpoints

**Files:**
- Modify: `warehouse-server/src/schemas/departmentSchemas.ts`
- Modify: `warehouse-server/src/controllers/departmentController.ts`
- Modify: `warehouse-server/src/controllers/companyController.ts`
- Test: `warehouse-server/src/tests/departments.test.ts`
- Test: `warehouse-server/src/tests/companies.test.ts`

**Interfaces:**
- Consumes: `departments.price_per_box_stored_monthly` column (Task 2).
- Produces: `PRICE_PER_BOX_STORED_MONTHLY` field on `GET /departments`, `GET /companies/:id` (`DEPARTMENTS[]`), and settable via `PUT /departments/:id` — the field name Task 6 (frontend) reads/writes.

The current `updateDepartmentSchema` in `warehouse-server/src/schemas/departmentSchemas.ts` is:

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

- [ ] **Step 1: Write the failing tests**

In `warehouse-server/src/tests/departments.test.ts`, replace the existing `'PUT /api/departments/:id accepts pricing fields'` test with:

```typescript
    it('PUT /api/departments/:id accepts pricing fields', async () => {
        mockExecute.mockResolvedValueOnce({
            rows: [{ ID: 1, PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20, PRICE_PER_BOX_STORED_MONTHLY: 5 }],
        });

        const res = await request(app).put('/api/departments/1').send({
            price_per_archived_box: 50,
            price_per_retrieved_box: 45,
            price_per_empty_carton: 20,
            price_per_box_stored_monthly: 5,
        });

        expect(res.status).toBe(200);
        expect(res.body.PRICE_PER_ARCHIVED_BOX).toBe(50);
        expect(res.body.PRICE_PER_BOX_STORED_MONTHLY).toBe(5);
    });
```

And replace the existing `'GET strips pricing fields for a non-admin user'` test's mock/assertions with:

```typescript
    it('GET strips pricing fields for a non-admin user', async () => {
        jest.resetModules();
        jest.doMock('../middleware/authMiddleware', () => ({
            authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
                (req as any).user = { id: 1, role: 'warehouse_admin' };
                next();
            },
            requireRole: (_roles: string[]) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../middleware/permissionMiddleware', () => ({
            requirePermission: (_key: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
        }));
        jest.doMock('../db/dbUtils', () => ({ execute: mockExecute }));

        mockExecute.mockResolvedValueOnce({
            rows: [{ ID: 10, NAME: 'CASH DEPT', PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20, PRICE_PER_BOX_STORED_MONTHLY: 5 }],
        });

        const staffRoutes = require('../routes/departmentRoutes').default;
        const staffApp = express();
        staffApp.use(express.json());
        staffApp.use('/api/departments', staffRoutes);

        const res = await request(staffApp).get('/api/departments');

        expect(res.status).toBe(200);
        expect(res.body[0].NAME).toBe('CASH DEPT');
        expect(res.body[0].PRICE_PER_ARCHIVED_BOX).toBeUndefined();
        expect(res.body[0].PRICE_PER_RETRIEVED_BOX).toBeUndefined();
        expect(res.body[0].PRICE_PER_EMPTY_CARTON).toBeUndefined();
        expect(res.body[0].PRICE_PER_BOX_STORED_MONTHLY).toBeUndefined();

        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/permissionMiddleware');
        jest.dontMock('../db/dbUtils');
        jest.resetModules();
    });
```

In `warehouse-server/src/tests/companies.test.ts`, update the `'GET /api/companies/:id strips department pricing fields for a non-admin user'` test's second mocked resolve and assertions to:

```typescript
        mockExecute
            .mockResolvedValueOnce({ rows: [{ ID: 1, NAME: 'AB Securitas' }] })
            .mockResolvedValueOnce({
                rows: [{ ID: 10, NAME: 'CASH DEPT', CURRENT_BOX_COUNT: 30, PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20, PRICE_PER_BOX_STORED_MONTHLY: 5 }],
            });
```
```typescript
        expect(res.body.DEPARTMENTS[0].PRICE_PER_ARCHIVED_BOX).toBeUndefined();
        expect(res.body.DEPARTMENTS[0].PRICE_PER_RETRIEVED_BOX).toBeUndefined();
        expect(res.body.DEPARTMENTS[0].PRICE_PER_EMPTY_CARTON).toBeUndefined();
        expect(res.body.DEPARTMENTS[0].PRICE_PER_BOX_STORED_MONTHLY).toBeUndefined();
```
(Keep everything else in both test files unchanged — only these two blocks change per file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd warehouse-server && npx jest src/tests/departments.test.ts src/tests/companies.test.ts`
Expected: FAIL — `PRICE_PER_BOX_STORED_MONTHLY` assertions fail because the schema rejects the new field (400 instead of 200) and the controllers don't select/strip it yet.

- [ ] **Step 3: Update `departmentSchemas.ts`**

Replace `updateDepartmentSchema` with:

```typescript
export const updateDepartmentSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(32).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    price_per_archived_box: z.number().nonnegative().optional(),
    price_per_retrieved_box: z.number().nonnegative().optional(),
    price_per_empty_carton: z.number().nonnegative().optional(),
    price_per_box_stored_monthly: z.number().nonnegative().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });
```

- [ ] **Step 4: Update `departmentController.ts`'s `getDepartments`**

In `warehouse-server/src/controllers/departmentController.ts`, the current `getDepartments` SELECT and strip logic is:

```typescript
        let query = `
            SELECT d.id, d.company_id, d.warehouse_id, d.name, d.code, d.status, d.current_box_count,
                   d.price_per_archived_box, d.price_per_retrieved_box, d.price_per_empty_carton,
                   w.name AS warehouse_name
            FROM departments d
            JOIN warehouses w ON w.id = d.warehouse_id
            WHERE 1=1
        `;
```
and
```typescript
        const rows = canSeePricing(user?.role)
            ? result.rows
            : result.rows.map((row: any) => {
                const { PRICE_PER_ARCHIVED_BOX, PRICE_PER_RETRIEVED_BOX, PRICE_PER_EMPTY_CARTON, ...rest } = row;
                return rest;
            });
```

Change the SELECT to also fetch the new column, and the strip destructure to also remove it:

```typescript
        let query = `
            SELECT d.id, d.company_id, d.warehouse_id, d.name, d.code, d.status, d.current_box_count,
                   d.price_per_archived_box, d.price_per_retrieved_box, d.price_per_empty_carton, d.price_per_box_stored_monthly,
                   w.name AS warehouse_name
            FROM departments d
            JOIN warehouses w ON w.id = d.warehouse_id
            WHERE 1=1
        `;
```
```typescript
        const rows = canSeePricing(user?.role)
            ? result.rows
            : result.rows.map((row: any) => {
                const { PRICE_PER_ARCHIVED_BOX, PRICE_PER_RETRIEVED_BOX, PRICE_PER_EMPTY_CARTON, PRICE_PER_BOX_STORED_MONTHLY, ...rest } = row;
                return rest;
            });
```

`updateDepartment` needs no code change — it builds its `SET` clause generically from `Object.keys(fields)`, so once the schema (Step 3) allows `price_per_box_stored_monthly` through, it's already handled.

- [ ] **Step 5: Update `companyController.ts`'s `getCompanyById`**

The current department SELECT and strip logic is:

```typescript
        let deptQuery = `
            SELECT d.id, d.name, d.code, d.status, d.current_box_count, d.warehouse_id, w.name AS warehouse_name,
                    d.price_per_archived_box, d.price_per_retrieved_box, d.price_per_empty_carton
             FROM departments d
             JOIN warehouses w ON w.id = d.warehouse_id
             WHERE d.company_id = :id
        `;
```
and
```typescript
        company.DEPARTMENTS = canSeePricing(role)
            ? deptResult.rows
            : deptResult.rows.map((row: any) => {
                const { PRICE_PER_ARCHIVED_BOX, PRICE_PER_RETRIEVED_BOX, PRICE_PER_EMPTY_CARTON, ...rest } = row;
                return rest;
            });
```

Change both the same way:

```typescript
        let deptQuery = `
            SELECT d.id, d.name, d.code, d.status, d.current_box_count, d.warehouse_id, w.name AS warehouse_name,
                    d.price_per_archived_box, d.price_per_retrieved_box, d.price_per_empty_carton, d.price_per_box_stored_monthly
             FROM departments d
             JOIN warehouses w ON w.id = d.warehouse_id
             WHERE d.company_id = :id
        `;
```
```typescript
        company.DEPARTMENTS = canSeePricing(role)
            ? deptResult.rows
            : deptResult.rows.map((row: any) => {
                const { PRICE_PER_ARCHIVED_BOX, PRICE_PER_RETRIEVED_BOX, PRICE_PER_EMPTY_CARTON, PRICE_PER_BOX_STORED_MONTHLY, ...rest } = row;
                return rest;
            });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd warehouse-server && npx jest src/tests/departments.test.ts src/tests/companies.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 7: Commit**

```bash
cd warehouse-server
git add src/schemas/departmentSchemas.ts src/controllers/departmentController.ts src/controllers/companyController.ts src/tests/departments.test.ts src/tests/companies.test.ts
git commit -m "feat: expose price_per_box_stored_monthly on department and company endpoints"
```

---

### Task 4: Integrate storage rental into invoice computation, persistence, and reversal

**Files:**
- Modify: `warehouse-server/src/controllers/invoiceController.ts`
- Test: `warehouse-server/src/tests/invoices.test.ts`

**Interfaces:**
- Consumes: `computeInvoiceAmounts(archivedCount, retrievedCount, emptyCartonCount, boxesStoredCount, prices, ssclRate, vatRate)` from Task 1, where `prices` has a `storedMonthly` field. Consumes `departments.current_box_count` and `departments.price_per_box_stored_monthly` (Task 2/3), and `invoices.box_count_at_billing`/`invoices.storage_rental_amount` columns (Task 2).
- Produces: `BOX_COUNT_AT_BILLING` and `STORAGE_RENTAL_AMOUNT` fields on the objects returned by `POST /invoices/preview`, `POST /invoices`, and `POST /invoices/:id/reverse` — the field names Task 5 (frontend) reads.

The current `computeBreakdown` in `warehouse-server/src/controllers/invoiceController.ts` is:

```typescript
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
```

- [ ] **Step 1: Write the failing tests**

In `warehouse-server/src/tests/invoices.test.ts`, update the `DEPT_ROW` fixture to include the two new department fields:

```typescript
const DEPT_ROW = {
    ID: 1, COMPANY_ID: 1, DEPARTMENT_NAME: 'CASH DEPT', COMPANY_NAME: 'AB Securitas',
    PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20,
    CURRENT_BOX_COUNT: 200, PRICE_PER_BOX_STORED_MONTHLY: 10,
};
```

In the `'POST /api/invoices/preview'` describe block, replace the `'computes a full breakdown without persisting anything'` test with:

```typescript
    it('computes a full breakdown without persisting anything, including storage rental', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [DEPT_ROW] })
            .mockResolvedValueOnce({ rows: [{ EVENT_TYPE: 'archived', TOTAL: 100 }, { EVENT_TYPE: 'retrieved', TOTAL: 20 }] });

        const res = await request(app).post('/api/invoices/preview').send(VALID_BODY);

        expect(res.status).toBe(200);
        // 100*50 + 20*45 + 200*10 = 5000 + 900 + 2000 = 7900
        expect(res.body.SUBTOTAL).toBe(7900);
        expect(res.body.BOX_COUNT_AT_BILLING).toBe(200);
        expect(res.body.STORAGE_RENTAL_AMOUNT).toBe(2000);
        expect(res.body.TOTAL_AMOUNT).toBeGreaterThan(res.body.SUBTOTAL);
        expect(mockExecute).toHaveBeenCalledTimes(2); // no INSERT
    });
```

In the `'POST /api/invoices'` describe block, replace the `'recomputes and saves an invoice, ignoring any client-submitted amounts'` test with:

```typescript
    it('recomputes and saves an invoice, ignoring any client-submitted amounts', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [DEPT_ROW] })
            .mockResolvedValueOnce({ rows: [{ EVENT_TYPE: 'archived', TOTAL: 100 }, { EVENT_TYPE: 'retrieved', TOTAL: 20 }] })
            .mockResolvedValueOnce({ rows: [{ ID: 1, DEPARTMENT_ID: 1, SUBTOTAL: 7900, TOTAL_AMOUNT: 9563.15 }] });

        const res = await request(app).post('/api/invoices').send({ ...VALID_BODY, total_amount: 1 });

        expect(res.status).toBe(201);
        expect(res.body.ID).toBe(1);
        const insertCall = mockExecute.mock.calls[2];
        expect(insertCall[0]).toMatch(/INSERT INTO invoices/);
        expect(insertCall[1].subtotal).toBe(7900); // server-recomputed, not the submitted "1"
        expect(insertCall[1].box_count_at_billing).toBe(200);
        expect(insertCall[1].storage_rental_amount).toBe(2000);
    });
```

In the `'POST /api/invoices/:id/reverse'` describe block, update `ORIGINAL_ROW` to include the two new invoice fields, and update the reversal test's assertions:

```typescript
    const ORIGINAL_ROW = {
        ID: 1, DEPARTMENT_ID: 1, COMPANY_ID: 1, DEPARTMENT_NAME: 'CASH DEPT', COMPANY_NAME: 'AB Securitas',
        PERIOD_FROM: '2026-07-01', PERIOD_TO: '2026-07-31',
        ARCHIVED_COUNT: 100, RETRIEVED_COUNT: 20, EMPTY_CARTON_COUNT: 5,
        PRICE_PER_ARCHIVED_BOX: 50, PRICE_PER_RETRIEVED_BOX: 45, PRICE_PER_EMPTY_CARTON: 20,
        BOX_COUNT_AT_BILLING: 200, STORAGE_RENTAL_AMOUNT: 2000,
        SUBTOTAL: 7900, SSCL_AMOUNT: 202.56, VAT_AMOUNT: 1458.46, TOTAL_AMOUNT: 9561.02,
        REVERSES_INVOICE_ID: null,
    };

    it('creates a negated mirror row linked to the original', async () => {
        mockExecute
            .mockResolvedValueOnce({ rows: [ORIGINAL_ROW] })
            .mockResolvedValueOnce({ rows: [{ ID: 2, REVERSES_INVOICE_ID: 1 }] });

        const res = await request(app).post('/api/invoices/1/reverse');

        expect(res.status).toBe(201);
        const insertCall = mockExecute.mock.calls[1];
        expect(insertCall[0]).toMatch(/INSERT INTO invoices/);
        expect(insertCall[1].archived_count).toBe(-100);
        expect(insertCall[1].retrieved_count).toBe(-20);
        expect(insertCall[1].empty_carton_count).toBe(-5);
        expect(insertCall[1].box_count_at_billing).toBe(200); // copied unchanged, not negated
        expect(insertCall[1].storage_rental_amount).toBe(-2000); // negated like other monetary fields
        expect(insertCall[1].subtotal).toBe(-7900);
        expect(insertCall[1].sscl_amount).toBe(-202.56);
        expect(insertCall[1].vat_amount).toBe(-1458.46);
        expect(insertCall[1].total_amount).toBe(-9561.02);
        expect(insertCall[1].reverses_invoice_id).toBe(1);
        expect(insertCall[1].period_from).toBe('2026-07-01');
        expect(insertCall[1].period_to).toBe('2026-07-31');
    });
```

(Leave the other tests in that describe block — `'returns 400 when the invoice does not exist'`, `'returns 400 when attempting to reverse an already-reversed invoice'`, `'returns 409 when the reversal collides with an existing one'` — unchanged; they don't assert on the new fields and `'returns 409...'` already reuses `ORIGINAL_ROW`, which now includes the new fields harmlessly.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd warehouse-server && npx jest src/tests/invoices.test.ts`
Expected: FAIL — subtotal/amount assertions are off (rental not yet included), `BOX_COUNT_AT_BILLING`/`STORAGE_RENTAL_AMOUNT` are `undefined`, and TypeScript will also flag the old 6-argument `computeInvoiceAmounts` call in `invoiceController.ts` (from Task 1's signature change) until Step 3 below fixes it.

- [ ] **Step 3: Update `computeBreakdown`**

Replace the function with:

```typescript
async function computeBreakdown(department_id: number, period_from: string, period_to: string) {
    const deptResult = await execute<any>(
        `SELECT d.id, d.company_id, d.name AS department_name, c.name AS company_name,
                d.price_per_archived_box, d.price_per_retrieved_box, d.price_per_empty_carton,
                d.current_box_count, d.price_per_box_stored_monthly
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

    const boxesStoredCount = dept.CURRENT_BOX_COUNT;

    const amounts = computeInvoiceAmounts(
        counts.archived,
        counts.retrieved,
        counts.empty_carton_issued,
        boxesStoredCount,
        {
            archived: dept.PRICE_PER_ARCHIVED_BOX,
            retrieved: dept.PRICE_PER_RETRIEVED_BOX,
            emptyCarton: dept.PRICE_PER_EMPTY_CARTON,
            storedMonthly: dept.PRICE_PER_BOX_STORED_MONTHLY,
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
        BOX_COUNT_AT_BILLING: boxesStoredCount,
        STORAGE_RENTAL_AMOUNT: dept.PRICE_PER_BOX_STORED_MONTHLY * boxesStoredCount,
        SUBTOTAL: amounts.subtotal,
        SSCL_AMOUNT: amounts.ssclAmount,
        VAT_AMOUNT: amounts.vatAmount,
        TOTAL_AMOUNT: amounts.totalAmount,
    };
}
```

Note: `STORAGE_RENTAL_AMOUNT` is computed directly here (not returned from `computeInvoiceAmounts`, which only returns the combined `subtotal`/`ssclAmount`/`vatAmount`/`totalAmount`) so it can be persisted as its own column — round it the same way `invoiceCalc.ts` rounds its own terms, i.e. it does not need separate rounding here since `price_per_box_stored_monthly` and `boxesStoredCount` are already exact NUMERIC/INTEGER values whose product needs no floating-point cleanup at this stage (this mirrors how `PRICE_PER_ARCHIVED_BOX` × count isn't separately rounded before being folded into the shared `computeInvoiceAmounts` subtotal rounding either).

- [ ] **Step 4: Update `createInvoice`'s INSERT**

The current INSERT in `createInvoice` is:

```typescript
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
```

Replace it with:

```typescript
        const result = await execute<any>(
            `INSERT INTO invoices (
                department_id, company_id, department_name, company_name,
                period_from, period_to, archived_count, retrieved_count, empty_carton_count,
                price_per_archived_box, price_per_retrieved_box, price_per_empty_carton,
                box_count_at_billing, storage_rental_amount,
                subtotal, sscl_amount, vat_amount, total_amount, created_by
            ) VALUES (
                :department_id, :company_id, :department_name, :company_name,
                :period_from, :period_to, :archived_count, :retrieved_count, :empty_carton_count,
                :price_per_archived_box, :price_per_retrieved_box, :price_per_empty_carton,
                :box_count_at_billing, :storage_rental_amount,
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
                box_count_at_billing: breakdown.BOX_COUNT_AT_BILLING,
                storage_rental_amount: breakdown.STORAGE_RENTAL_AMOUNT,
                subtotal: breakdown.SUBTOTAL,
                sscl_amount: breakdown.SSCL_AMOUNT,
                vat_amount: breakdown.VAT_AMOUNT,
                total_amount: breakdown.TOTAL_AMOUNT,
                created_by: userId,
            }
        );
```

- [ ] **Step 5: Update `reverseInvoice`'s INSERT**

The current INSERT in `reverseInvoice` is:

```typescript
        const result = await execute<any>(
            `INSERT INTO invoices (
                department_id, company_id, department_name, company_name,
                period_from, period_to, archived_count, retrieved_count, empty_carton_count,
                price_per_archived_box, price_per_retrieved_box, price_per_empty_carton,
                subtotal, sscl_amount, vat_amount, total_amount, created_by, reverses_invoice_id
            ) VALUES (
                :department_id, :company_id, :department_name, :company_name,
                :period_from, :period_to, :archived_count, :retrieved_count, :empty_carton_count,
                :price_per_archived_box, :price_per_retrieved_box, :price_per_empty_carton,
                :subtotal, :sscl_amount, :vat_amount, :total_amount, :created_by, :reverses_invoice_id
            ) RETURNING *`,
            {
                department_id: original.DEPARTMENT_ID,
                company_id: original.COMPANY_ID,
                department_name: original.DEPARTMENT_NAME,
                company_name: original.COMPANY_NAME,
                period_from: original.PERIOD_FROM,
                period_to: original.PERIOD_TO,
                archived_count: -original.ARCHIVED_COUNT,
                retrieved_count: -original.RETRIEVED_COUNT,
                empty_carton_count: -original.EMPTY_CARTON_COUNT,
                price_per_archived_box: original.PRICE_PER_ARCHIVED_BOX,
                price_per_retrieved_box: original.PRICE_PER_RETRIEVED_BOX,
                price_per_empty_carton: original.PRICE_PER_EMPTY_CARTON,
                subtotal: -original.SUBTOTAL,
                sscl_amount: -original.SSCL_AMOUNT,
                vat_amount: -original.VAT_AMOUNT,
                total_amount: -original.TOTAL_AMOUNT,
                created_by: userId,
                reverses_invoice_id: original.ID,
            }
        );
```

Replace it with:

```typescript
        const result = await execute<any>(
            `INSERT INTO invoices (
                department_id, company_id, department_name, company_name,
                period_from, period_to, archived_count, retrieved_count, empty_carton_count,
                price_per_archived_box, price_per_retrieved_box, price_per_empty_carton,
                box_count_at_billing, storage_rental_amount,
                subtotal, sscl_amount, vat_amount, total_amount, created_by, reverses_invoice_id
            ) VALUES (
                :department_id, :company_id, :department_name, :company_name,
                :period_from, :period_to, :archived_count, :retrieved_count, :empty_carton_count,
                :price_per_archived_box, :price_per_retrieved_box, :price_per_empty_carton,
                :box_count_at_billing, :storage_rental_amount,
                :subtotal, :sscl_amount, :vat_amount, :total_amount, :created_by, :reverses_invoice_id
            ) RETURNING *`,
            {
                department_id: original.DEPARTMENT_ID,
                company_id: original.COMPANY_ID,
                department_name: original.DEPARTMENT_NAME,
                company_name: original.COMPANY_NAME,
                period_from: original.PERIOD_FROM,
                period_to: original.PERIOD_TO,
                archived_count: -original.ARCHIVED_COUNT,
                retrieved_count: -original.RETRIEVED_COUNT,
                empty_carton_count: -original.EMPTY_CARTON_COUNT,
                price_per_archived_box: original.PRICE_PER_ARCHIVED_BOX,
                price_per_retrieved_box: original.PRICE_PER_RETRIEVED_BOX,
                price_per_empty_carton: original.PRICE_PER_EMPTY_CARTON,
                box_count_at_billing: original.BOX_COUNT_AT_BILLING,
                storage_rental_amount: -original.STORAGE_RENTAL_AMOUNT,
                subtotal: -original.SUBTOTAL,
                sscl_amount: -original.SSCL_AMOUNT,
                vat_amount: -original.VAT_AMOUNT,
                total_amount: -original.TOTAL_AMOUNT,
                created_by: userId,
                reverses_invoice_id: original.ID,
            }
        );
```

Note `box_count_at_billing: original.BOX_COUNT_AT_BILLING` is copied WITHOUT a minus sign (per the spec — it's an informational snapshot, not a delta), while `storage_rental_amount: -original.STORAGE_RENTAL_AMOUNT` IS negated (it's a real monetary line, same treatment as `subtotal`/`sscl_amount`/etc.).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd warehouse-server && npx jest src/tests/invoices.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 7: Run the full backend test suite to confirm no regressions**

Run: `cd warehouse-server && npx jest`
Expected: PASS, all test suites green (this also confirms Task 1's `invoiceCalc.ts` signature change compiles cleanly now that this task's `invoiceController.ts` call site is updated).

- [ ] **Step 8: Commit**

```bash
cd warehouse-server
git add src/controllers/invoiceController.ts src/tests/invoices.test.ts
git commit -m "feat: fold storage rental into invoice computation and reversal"
```

---

### Task 5: Frontend — pricing field and invoice display

**Files:**
- Modify: `warehouse-client/src/types.ts`
- Modify: `warehouse-client/src/pages/CompanyDetail.tsx`
- Modify: `warehouse-client/src/pages/Invoices.tsx`

**Interfaces:**
- Consumes: `PRICE_PER_BOX_STORED_MONTHLY` (Task 3), `BOX_COUNT_AT_BILLING`/`STORAGE_RENTAL_AMOUNT` (Task 4).

- [ ] **Step 1: Update `types.ts`**

The current `Department` interface is:

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

Add the new field:

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
    PRICE_PER_BOX_STORED_MONTHLY: number;
}
```

The current `InvoiceBreakdown` interface is:

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
```

Add the two new fields:

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
    BOX_COUNT_AT_BILLING: number;
    STORAGE_RENTAL_AMOUNT: number;
    SUBTOTAL: number;
    SSCL_AMOUNT: number;
    VAT_AMOUNT: number;
    TOTAL_AMOUNT: number;
}
```

(`Invoice extends InvoiceBreakdown` already picks up the two new fields automatically — no separate change needed there.)

- [ ] **Step 2: Update `CompanyDetail.tsx`'s pricing table**

In `warehouse-client/src/pages/CompanyDetail.tsx`, add a new state variable next to the existing three:

```typescript
    const [editArchivedPrice, setEditArchivedPrice] = useState('');
    const [editRetrievedPrice, setEditRetrievedPrice] = useState('');
    const [editEmptyCartonPrice, setEditEmptyCartonPrice] = useState('');
```
becomes:
```typescript
    const [editArchivedPrice, setEditArchivedPrice] = useState('');
    const [editRetrievedPrice, setEditRetrievedPrice] = useState('');
    const [editEmptyCartonPrice, setEditEmptyCartonPrice] = useState('');
    const [editStoredMonthlyPrice, setEditStoredMonthlyPrice] = useState('');
```

`startEditDept` currently is:

```typescript
    const startEditDept = (d: Department) => {
        setEditingDeptId(d.ID);
        setEditArchivedPrice(String(d.PRICE_PER_ARCHIVED_BOX ?? 0));
        setEditRetrievedPrice(String(d.PRICE_PER_RETRIEVED_BOX ?? 0));
        setEditEmptyCartonPrice(String(d.PRICE_PER_EMPTY_CARTON ?? 0));
    };
```
becomes:
```typescript
    const startEditDept = (d: Department) => {
        setEditingDeptId(d.ID);
        setEditArchivedPrice(String(d.PRICE_PER_ARCHIVED_BOX ?? 0));
        setEditRetrievedPrice(String(d.PRICE_PER_RETRIEVED_BOX ?? 0));
        setEditEmptyCartonPrice(String(d.PRICE_PER_EMPTY_CARTON ?? 0));
        setEditStoredMonthlyPrice(String(d.PRICE_PER_BOX_STORED_MONTHLY ?? 0));
    };
```

`saveEditDept` currently is:

```typescript
    const saveEditDept = async (deptId: number) => {
        try {
            const body: Record<string, number> = {};
            if (editArchivedPrice !== '') body.price_per_archived_box = Number(editArchivedPrice);
            if (editRetrievedPrice !== '') body.price_per_retrieved_box = Number(editRetrievedPrice);
            if (editEmptyCartonPrice !== '') body.price_per_empty_carton = Number(editEmptyCartonPrice);
            await api.put(`/departments/${deptId}`, body);
            toast.success('Pricing updated');
            setEditingDeptId(null);
            load();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update pricing');
        }
    };
```
becomes:
```typescript
    const saveEditDept = async (deptId: number) => {
        try {
            const body: Record<string, number> = {};
            if (editArchivedPrice !== '') body.price_per_archived_box = Number(editArchivedPrice);
            if (editRetrievedPrice !== '') body.price_per_retrieved_box = Number(editRetrievedPrice);
            if (editEmptyCartonPrice !== '') body.price_per_empty_carton = Number(editEmptyCartonPrice);
            if (editStoredMonthlyPrice !== '') body.price_per_box_stored_monthly = Number(editStoredMonthlyPrice);
            await api.put(`/departments/${deptId}`, body);
            toast.success('Pricing updated');
            setEditingDeptId(null);
            load();
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to update pricing');
        }
    };
```

The table header currently is:

```tsx
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
```
Add a column:
```tsx
                        <tr>
                            <th className="p-3">Name</th>
                            <th className="p-3">Code</th>
                            <th className="p-3">Warehouse</th>
                            <th className="p-3">Current Box Count</th>
                            <th className="p-3">Price/Archived</th>
                            <th className="p-3">Price/Retrieved</th>
                            <th className="p-3">Price/Empty Carton</th>
                            <th className="p-3">Price/Storage Rental (monthly)</th>
                            <th className="p-3">Actions</th>
                        </tr>
```

The editing-row `<tr>` currently is:

```tsx
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
```
Add an input cell for the new price, right after the empty-carton cell:
```tsx
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
                                        <input type="number" min="0" step="0.01" className="border border-slate-300 rounded px-2 py-1 w-24" value={editStoredMonthlyPrice} onChange={(e) => setEditStoredMonthlyPrice(e.target.value)} />
                                    </td>
                                    <td className="p-2">
                                        <div className="flex gap-2">
                                            <button onClick={() => saveEditDept(d.ID)} className="text-green-600 hover:text-green-700" title="Save"><Check size={16} /></button>
                                            <button onClick={cancelEditDept} className="text-slate-400 hover:text-slate-600" title="Cancel"><X size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
```

The read-only-row `<tr>` currently is:

```tsx
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
```
Add a display cell:
```tsx
                                <tr key={d.ID} className="border-t border-slate-100">
                                    <td className="p-3">{d.NAME}</td>
                                    <td className="p-3">{d.CODE}</td>
                                    <td className="p-3">{d.WAREHOUSE_NAME}</td>
                                    <td className="p-3">{d.CURRENT_BOX_COUNT}</td>
                                    <td className="p-3">{d.PRICE_PER_ARCHIVED_BOX}</td>
                                    <td className="p-3">{d.PRICE_PER_RETRIEVED_BOX}</td>
                                    <td className="p-3">{d.PRICE_PER_EMPTY_CARTON}</td>
                                    <td className="p-3">{d.PRICE_PER_BOX_STORED_MONTHLY}</td>
                                    <td className="p-3">
                                        <button onClick={() => startEditDept(d)} className="text-slate-500 hover:text-blue-600" title="Edit"><Pencil size={16} /></button>
                                    </td>
                                </tr>
```

- [ ] **Step 3: Update `Invoices.tsx`'s preview breakdown table**

The current preview table body is:

```tsx
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
```

Insert a "Storage Rental" row after the empty-cartons row and before the Subtotal row:

```tsx
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
                            <tr className="border-t border-slate-100">
                                <td className="p-2">Storage rental</td>
                                <td className="p-2">{preview.BOX_COUNT_AT_BILLING} boxes × {preview.STORAGE_RENTAL_AMOUNT / (preview.BOX_COUNT_AT_BILLING || 1)} = {preview.STORAGE_RENTAL_AMOUNT}</td>
                            </tr>
                            <tr className="border-t border-slate-200 font-medium">
                                <td className="p-2">Subtotal</td>
                                <td className="p-2">{preview.SUBTOTAL}</td>
                            </tr>
```

(The other three rows — SSCL, VAT, Total — are unchanged; they already read `preview.SUBTOTAL`/`SSCL_AMOUNT`/`VAT_AMOUNT`/`TOTAL_AMOUNT`, which already include the rental term from Task 4's `computeBreakdown`.)

- [ ] **Step 4: Run the frontend build to verify no type errors**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd warehouse-client
git add src/types.ts src/pages/CompanyDetail.tsx src/pages/Invoices.tsx
git commit -m "feat: add storage rental price field and invoice line to the UI"
```

---

### Task 6: Final verification — live migration, live invoice generation, and screenshot evidence

**Files:** none (verification only — no code changes expected; if verification surfaces a bug, fix it in the relevant file from Tasks 1-5 and note the fix in the report).

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Run the full backend test suite**

Run: `cd warehouse-server && npx jest`
Expected: PASS, every suite green (should already be true after Task 4's Step 7, but re-run here as the final gate after Task 5's frontend-only changes, which don't touch the backend, to confirm nothing regressed).

- [ ] **Step 2: Run the frontend build**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Boot the migration twice against the real database**

Run (from `warehouse-server/`), twice in a row:
```bash
npx ts-node -e "require('./src/db/config').initializeDb().then(()=>{console.log('INIT_OK');process.exit(0)}).catch((e)=>{console.error('INIT_FAIL',e);process.exit(1)})"
```
Expected both times: `INIT_OK`.

- [ ] **Step 4: Verify schema live**

Run:
```bash
docker exec wh-postgres psql -U dokwarehouse -d dok_warehouse -c "\d departments"
docker exec wh-postgres psql -U dokwarehouse -d dok_warehouse -c "\d invoices"
```
Expected: `price_per_box_stored_monthly` present on `departments`; `box_count_at_billing` and `storage_rental_amount` present on `invoices`.

- [ ] **Step 5: Live E2E via curl against the real running backend**

The backend dev server must already be running on port 5100 (`Warehouse server running on port 5100` in its log) and connected to the real `wh-postgres` container. Write a scratch script (e.g. `D:/tmp/smoke_storage_rental.mjs`) that:

1. Logs in as `admin`/`password123` against `POST http://localhost:5100/api/auth/login`.
2. Fetches `GET /api/departments`, picks a department, and records its current `PRICE_PER_BOX_STORED_MONTHLY` and `CURRENT_BOX_COUNT` (to restore/compare afterward).
3. Sets `PUT /api/departments/:id` with `{ price_per_box_stored_monthly: 10 }`.
4. Calls `POST /api/invoices/preview` for that department for a test period, and asserts `BOX_COUNT_AT_BILLING === department's CURRENT_BOX_COUNT` and `STORAGE_RENTAL_AMOUNT === CURRENT_BOX_COUNT * 10`.
5. Calls `POST /api/invoices` to save it, then `POST /api/invoices/:id/reverse`, and asserts the reversal row's `storage_rental_amount` is the negation and `box_count_at_billing` is unchanged (fetch via `GET /api/invoices?department_id=...` or inspect the reverse response directly).
6. Restores the department's `price_per_box_stored_monthly` to its original value via `PUT`, and deletes the two invoice rows created (`DELETE FROM invoices WHERE id IN (...)` directly via `docker exec wh-postgres psql`, matching how prior smoke tests in this session cleaned up test invoice rows) so no test data is left behind.

Run it: `node D:/tmp/smoke_storage_rental.mjs`
Expected: all assertions pass, printed confirmation of each step.

- [ ] **Step 6: Live UI screenshot via Playwright**

Using the existing Playwright install in this session's scratchpad
(`.../scratchpad/node_modules`), write a script that:
1. Logs into the frontend (`http://localhost:5175/login`) as `admin`/`password123`.
2. Navigates to a company's detail page, sets a non-zero storage rental price on a department via the UI, saves, and screenshots the pricing table showing the new column and value.
3. Navigates to `/invoices`, fills the preview form for that department/period, clicks Preview, and screenshots the breakdown table showing the new "Storage rental" row with a non-zero amount.

Run it, then use the Read tool on both screenshots to visually confirm the new column and row render correctly with the expected values.

- [ ] **Step 7: Report**

Summarize: test counts (backend/frontend), migration idempotency confirmed, live E2E assertions that passed, and the two screenshots confirmed. No commit needed for this task unless a bug fix was required during verification (in which case commit that fix in its own commit, referencing which file it touched).
