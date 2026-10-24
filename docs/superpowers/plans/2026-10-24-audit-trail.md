# Audit Trail (FR-30) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every create, update, delete, or reverse on the five financial/HR
modules (Invoices, Payroll, Warehouse Expenses, Staff, Attendance) writes a
row to a new `audit_log` table recording the acting user, a timestamp, and
before/after values — atomically with the mutation it logs.

**Architecture:** A new `audit_log` table (migration in
`warehouse-server/src/db/config.ts`) plus a `logAudit()` helper
(`warehouse-server/src/utils/auditLog.ts`) called from inside each
instrumented controller's `withTransaction()` block. Every instrumented
endpoint that doesn't already use `withTransaction` is converted to use it,
so the primary write and the audit write commit or roll back together. A
new `GET /audit-log` endpoint, gated to `system_admin` by a direct role
check, lets that row data be queried.

**Tech Stack:** Node.js/Express 5/TypeScript, PostgreSQL via `pg`
(no ORM — named-parameter SQL via `execute()`/`withTransaction()` in
`warehouse-server/src/db/dbUtils.ts`), Zod for request validation, Jest +
Supertest for tests.

**Spec:** `docs/superpowers/specs/2026-10-24-audit-trail-design.md` — Audit
Trail (FR-30)

## Global Constraints

- `logAudit()`'s `exec` parameter is typed `TxExecutor` (imported from
  `../db/dbUtils`), not the spec pseudocode's placeholder `QueryExecutor` —
  confirmed by reading `warehouse-server/src/db/dbUtils.ts`: `TxExecutor` is
  the real exported type for the function `withTransaction` hands to its
  callback.
- Every instrumented endpoint wraps its primary write AND its `logAudit()`
  call in one `withTransaction()` call. `logAudit()` must always be called
  with the transaction's `exec`, never the module-level `execute`.
- **Correction to the spec's conversion list:** the spec's Decisions
  section says only `createExpense`, `createStaff`, `updateStaff`, and
  `bulkMarkAttendance` need converting to `withTransaction`. Re-reading
  every target controller this session shows the actual current state is
  different: `bulkMarkAttendance` **already** uses `withTransaction` (no
  conversion needed there), while `createInvoice`, `reverseInvoice`, and
  **all six** Payroll handlers (`createPayroll`, `updatePayroll`,
  `submitPayroll`, `approvePayroll`, `rejectPayroll`, `reversePayroll`),
  plus `updateExpense` and `deleteExpense`, currently use plain `execute()`
  and also need conversion. This plan's per-task file lists reflect the
  real current state, not the spec's list.
- `table_name` values are exactly: `invoices`, `payroll`, `warehouse_expenses`,
  `staff`, `attendance` — the real DB table names.
- `before_value`/`after_value` passed to `logAudit()` are plain JS objects
  (full DB rows, UPPERCASE-keyed as `execute`/`withTransaction` already
  return them) or `null`; `logAudit()` itself handles `JSON.stringify`.
- No new permission key. `GET /audit-log` checks `req.user.role === 'system_admin'`
  directly, matching `isApprover`-style checks already in `payrollController.ts`.
- No frontend work, no retention/pruning policy — out of scope per spec.

## Review Focus

- **A controller error after the primary write but before `logAudit()`
  resolves still rolls back the primary write.** `withTransaction` already
  guarantees this (any throw inside the callback triggers `ROLLBACK`), but
  a converted endpoint that accidentally keeps a stray `execute()` call
  outside the transaction would silently break this guarantee. Task 2's
  transactional-atomicity test (and the pattern it establishes, reused in
  Tasks 3-6) pins this: if the mocked audit insert rejects, the mocked
  primary insert's effects must not be observable.
- **`JSON.stringify(null)` is `"null"`, not SQL `NULL`.** A naive
  implementation of `logAudit()` could pass the four-character string
  `"null"` into a JSONB column for a `create`'s `before_value` or a
  `delete`'s `after_value`, which is a valid-but-wrong JSONB value
  (`'null'::jsonb`), not an actual `NULL`. Task 1's unit test for
  `logAudit()` asserts the param object's `before_value`/`after_value`
  keys are the literal JS `null`, not the string `"null"`.
  (`convertParams` null-coalesces undefined/null to `null` is fine; a
  JSON-string `"null"` would not be caught there.)
- **`bulkMarkAttendance` must log one row per staff member, not one row
  for the whole batch**, and must distinguish `create` (no prior row for
  that staff/date) from `update` (a prior row existed) per staff member
  within the same batch. Task 6's test exercises a mixed batch (one new
  staff member, one staff member with an existing record for that date)
  and asserts two distinct `audit_log` inserts with the correct `action`
  each.
- **`GET /audit-log` must 403 for every role except `system_admin`**,
  including `finance_officer` and `warehouse_admin` — both of which have
  elevated access elsewhere in this app (finance_officer approves payroll;
  warehouse_admin is scoped but still privileged) and would be an easy
  role check to get wrong (e.g. accidentally reusing `isApprover`'s
  `system_admin || finance_officer` check). Task 7's gate test asserts
  403 for both `finance_officer` and `warehouse_admin`, not just "any
  non-admin".
- **`reverseInvoice`/`reversePayroll` log `before_value` as the ORIGINAL
  row unchanged**, not re-fetched after the reversal (which would still be
  unchanged, but a careless implementation might try to "re-select" it
  inside the transaction and get a different row shape, e.g. missing a
  field the SELECT-before-insert already had). Tasks 2 and 3's reverse
  tests assert `before_value` is passed as the exact object the pre-insert
  SELECT returned, not a second query's result.

---

## Task 1: `audit_log` table, `logAudit()` helper, and its unit tests

**Files:**
- Modify: `warehouse-server/src/db/config.ts` (add migration after the
  existing invoices block, i.e. after line 338's
  `CREATE INDEX IF NOT EXISTS idx_invoices_department` statement, before
  `client.release()` at line 340)
- Create: `warehouse-server/src/utils/auditLog.ts`
- Test: `warehouse-server/src/tests/auditLog.test.ts`

**Interfaces:**
- Produces: `logAudit(exec: TxExecutor, tableName: string, recordId: number, action: AuditAction, actorId: number | null, beforeValue: unknown, afterValue: unknown): Promise<void>`
  and `export type AuditAction = 'create' | 'update' | 'delete' | 'reverse'`
  from `warehouse-server/src/utils/auditLog.ts` — every later task imports
  both from this file.

- [ ] **Step 1: Add the `audit_log` table and index migration to `config.ts`**

Insert immediately after the existing `idx_invoices_department` index
statement (around line 338) and before `client.release()`:

```sql
CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    table_name    VARCHAR(50) NOT NULL,
    record_id     INTEGER NOT NULL,
    action        VARCHAR(20) NOT NULL CHECK (action IN ('create','update','delete','reverse')),
    actor_id      INTEGER REFERENCES users(id),
    before_value  JSONB,
    after_value   JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
followed by three more `client.query()` calls for:
```sql
CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
```
Follow this file's existing style: one `await client.query(\`...\`);` per
statement, matching every other table block in this file (e.g. the
`box_events` block at lines 171-188).

- [ ] **Step 2: Write `logAudit()`'s unit tests**

```typescript
// warehouse-server/src/tests/auditLog.test.ts
import { logAudit } from '../utils/auditLog';

describe('logAudit', () => {
    it('inserts with the given table_name, record_id, action, and actor_id', async () => {
        const exec = jest.fn().mockResolvedValue({ rows: [] });
        await logAudit(exec as any, 'invoices', 7, 'create', 3, null, { ID: 7 });
        const [sql, params] = exec.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO audit_log/);
        expect(params).toMatchObject({ table_name: 'invoices', record_id: 7, action: 'create', actor_id: 3 });
    });

    it('serializes a null before_value to SQL NULL, not the string "null"', async () => {
        const exec = jest.fn().mockResolvedValue({ rows: [] });
        await logAudit(exec as any, 'invoices', 7, 'create', 3, null, { ID: 7 });
        const [, params] = exec.mock.calls[0];
        expect(params.before_value).toBeNull();
    });

    it('serializes a null after_value to SQL NULL, not the string "null"', async () => {
        const exec = jest.fn().mockResolvedValue({ rows: [] });
        await logAudit(exec as any, 'warehouse_expenses', 7, 'delete', 3, { ID: 7 }, null);
        const [, params] = exec.mock.calls[0];
        expect(params.after_value).toBeNull();
    });

    it('JSON-serializes a non-null before/after value', async () => {
        const exec = jest.fn().mockResolvedValue({ rows: [] });
        await logAudit(exec as any, 'staff', 7, 'update', 3, { ID: 7, NAME: 'A' }, { ID: 7, NAME: 'B' });
        const [, params] = exec.mock.calls[0];
        expect(JSON.parse(params.before_value)).toEqual({ ID: 7, NAME: 'A' });
        expect(JSON.parse(params.after_value)).toEqual({ ID: 7, NAME: 'B' });
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd warehouse-server && npx jest auditLog.test.ts`
Expected: FAIL — `../utils/auditLog` module not found.

- [ ] **Step 4: Implement `logAudit()` in `warehouse-server/src/utils/auditLog.ts`**

```typescript
import { TxExecutor } from '../db/dbUtils';

export type AuditAction = 'create' | 'update' | 'delete' | 'reverse';

export async function logAudit(
    exec: TxExecutor,
    tableName: string,
    recordId: number,
    action: AuditAction,
    actorId: number | null,
    beforeValue: unknown,
    afterValue: unknown
): Promise<void> {
    await exec(
        `INSERT INTO audit_log (table_name, record_id, action, actor_id, before_value, after_value)
         VALUES (:table_name, :record_id, :action, :actor_id, :before_value, :after_value)`,
        {
            table_name: tableName,
            record_id: recordId,
            action,
            actor_id: actorId,
            before_value: beforeValue == null ? null : JSON.stringify(beforeValue),
            after_value: afterValue == null ? null : JSON.stringify(afterValue),
        }
    );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd warehouse-server && npx jest auditLog.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add warehouse-server/src/db/config.ts warehouse-server/src/utils/auditLog.ts warehouse-server/src/tests/auditLog.test.ts
git commit -m "feat: add audit_log table and logAudit helper"
```

---

## Task 2: Instrument Invoices (`createInvoice`, `reverseInvoice`)

**Files:**
- Modify: `warehouse-server/src/controllers/invoiceController.ts`
  (`createInvoice` at lines 91-144, `reverseInvoice` at lines 164-222)
- Test: `warehouse-server/src/tests/invoices.test.ts` (existing file —
  add new `describe` blocks; do not restructure existing tests)

**Interfaces:**
- Consumes: `logAudit(exec: TxExecutor, tableName: string, recordId: number, action: AuditAction, actorId: number | null, beforeValue: unknown, afterValue: unknown): Promise<void>` and `AuditAction` from Task 1's `../utils/auditLog`.
- Consumes: `withTransaction<R>(fn: (exec: TxExecutor) => Promise<R>): Promise<R>` from `../db/dbUtils` (already imported elsewhere in this codebase; `invoiceController.ts` currently only imports `execute`).

- [ ] **Step 1: Write the failing tests**

Read the existing `warehouse-server/src/tests/invoices.test.ts` to match
its mocking style first (it mocks `../db/dbUtils`; check whether it
currently mocks only `execute` or also `withTransaction` — if only
`execute`, extend the `jest.mock('../db/dbUtils', ...)` factory to also
export `withTransaction: jest.fn(async (fn) => fn(execute))`, matching the
pattern in `warehouse-server/src/tests/boxEvents.test.ts`). Add:

```typescript
describe('POST /api/invoices audit logging', () => {
    it('logs a create audit row for the new invoice inside the same transaction', async () => {
        // Arrange mockExecute so the department lookup, box-event counts, and the
        // INSERT ... RETURNING * each resolve, then assert one of the exec calls
        // is an INSERT INTO audit_log with action: 'create', before_value: null,
        // and after_value equal to the JSON-stringified invoice row the INSERT returned.
    });

    it('rolls back the invoice insert if the audit insert fails', async () => {
        // Arrange the audit_log INSERT's mock call to reject; assert the endpoint
        // returns a 500 and that withTransaction's thrown error prevented a
        // successful response — i.e. the primary insert's effects are not
        // observable as a committed 201.
    });
});

describe('POST /api/invoices/:id/reverse audit logging', () => {
    it('logs a reverse audit row with before_value = the original invoice and after_value = the new reversal row', async () => {
        // Arrange the original-invoice SELECT and the reversal INSERT ... RETURNING *
        // to each resolve with distinct row shapes; assert the audit_log INSERT's
        // before_value JSON-parses to exactly the SELECT's row and after_value
        // JSON-parses to exactly the INSERT's row.
    });
});
```

Fill in concrete `mockExecute`/`mockWithTransaction` arrangements
following the existing test file's conventions for mocking multi-step
`execute` sequences (see `boxEvents.test.ts`'s `mockResolvedValueOnce`
chaining for a withTransaction-wrapped endpoint).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd warehouse-server && npx jest invoices.test.ts`
Expected: FAIL (no audit_log INSERT occurs yet)

- [ ] **Step 3: Convert `createInvoice` to `withTransaction` and add audit logging**

Replace the module import `import { execute } from '../db/dbUtils';` with
`import { execute, withTransaction } from '../db/dbUtils';` and add
`import { logAudit } from '../utils/auditLog';`.

Wrap the existing `execute<any>(...)` INSERT call (lines 100-135) in
`withTransaction(async (exec) => { ... })`, using `exec` in place of
`execute` for that one INSERT, then call
`await logAudit(exec, 'invoices', result.rows[0].ID, 'create', userId, null, result.rows[0])`
before returning the inserted row from the callback. `computeBreakdown`
(which only reads) stays on the module-level `execute`, unchanged, called
before `withTransaction` as it already is. Keep the existing
`err.code === '23505'` catch behavior around the whole thing.

- [ ] **Step 4: Convert `reverseInvoice` to `withTransaction` and add audit logging**

Same import already added in Step 3. Wrap the existing `execute<any>(...)`
reversal INSERT (lines 177-213) in `withTransaction(async (exec) => { ... })`,
using `exec` for that INSERT, then call
`await logAudit(exec, 'invoices', result.rows[0].ID, 'reverse', userId, original, result.rows[0])`
— `original` is the already-fetched row from the pre-insert SELECT (keep
that SELECT on the module-level `execute`, unchanged, run before
`withTransaction` as it already is). Keep the existing `23505` catch
behavior.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd warehouse-server && npx jest invoices.test.ts`
Expected: PASS (all existing invoices.test.ts tests plus the new ones)

- [ ] **Step 6: Commit**

```bash
git add warehouse-server/src/controllers/invoiceController.ts warehouse-server/src/tests/invoices.test.ts
git commit -m "feat: audit-log invoice create and reverse"
```

---

## Task 3: Instrument Payroll (6 handlers)

**Files:**
- Modify: `warehouse-server/src/controllers/payrollController.ts`
  (`createPayroll` lines 23-77, `updatePayroll` lines 105-143,
  `submitPayroll` lines 145-165, `approvePayroll` lines 167-187,
  `rejectPayroll` lines 189-208, `reversePayroll` lines 210-257)
- Test: `warehouse-server/src/tests/payroll.test.ts` (existing file — add
  new `describe` blocks)

**Interfaces:**
- Consumes: `logAudit`/`AuditAction` from Task 1's `../utils/auditLog`.
- Consumes: `withTransaction` from `../db/dbUtils` (add to this file's
  existing `import { execute } from '../db/dbUtils';`).

- [ ] **Step 1: Write the failing tests**

Add to `payroll.test.ts`, following its existing mocking conventions
(extend `withTransaction` into the `../db/dbUtils` mock the same way as
Task 2 if not already present):

```typescript
describe('payroll audit logging', () => {
    it('createPayroll logs a create row with before_value null and after_value the new payroll row', async () => { /* ... */ });
    it('updatePayroll logs an update row with before_value the pre-edit row and after_value the post-edit row', async () => { /* ... */ });
    it('submitPayroll logs an update row (status draft/rejected -> pending_approval)', async () => { /* ... */ });
    it('approvePayroll logs an update row (status pending_approval -> approved)', async () => { /* ... */ });
    it('rejectPayroll logs an update row (status pending_approval -> rejected)', async () => { /* ... */ });
    it('reversePayroll logs a reverse row with before_value the original (unchanged) and after_value the new reversal row', async () => { /* ... */ });
    it('rolls back the primary write if the audit insert fails (createPayroll)', async () => { /* ... */ });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd warehouse-server && npx jest payroll.test.ts`
Expected: FAIL

- [ ] **Step 3: Convert all six handlers to `withTransaction` and add audit logging**

Add `withTransaction` to the existing `import { execute } from '../db/dbUtils';`
and add `import { logAudit } from '../utils/auditLog';`.

For each handler, wrap only its mutating `execute<any>(...)` call(s) in
`withTransaction(async (exec) => { ... })` (read-only lookups — the staff
lookup in `createPayroll`, the existence/status checks already present in
each handler — stay on module-level `execute`, run before
`withTransaction` exactly as they already are):

- `createPayroll`: wrap the INSERT; `logAudit(exec, 'payroll', result.rows[0].ID, 'create', (req as any).user?.id ?? null, null, result.rows[0])`.
- `updatePayroll`: wrap the UPDATE; `logAudit(exec, 'payroll', result.rows[0].ID, 'update', (req as any).user?.id ?? null, existing, result.rows[0])` — `existing` is the row the pre-update SELECT already fetched.
- `submitPayroll`: wrap the UPDATE; before it, this handler has no pre-fetch today — add one (`SELECT * FROM payroll WHERE id = :id` with the same scope filter already applied to the UPDATE) inside the same `withTransaction` callback, using `exec`, so `before_value` reflects the row immediately before this transaction's UPDATE; `logAudit(exec, 'payroll', result.rows[0].ID, 'update', (req as any).user?.id ?? null, before, result.rows[0])`.
- `approvePayroll`: same pattern as `submitPayroll` — add a pre-fetch SELECT inside the transaction, then `logAudit(exec, 'payroll', result.rows[0].ID, 'update', userId, before, result.rows[0])`.
- `rejectPayroll`: same pattern.
- `reversePayroll`: wrap the reversal INSERT; keep the existing pre-insert SELECT (`originalResult`) on module-level `execute`, run before `withTransaction`; `logAudit(exec, 'payroll', result.rows[0].ID, 'reverse', userId, original, result.rows[0])`.

Keep every handler's existing status/role/404/403/409 checks and error
handling exactly as they are — only the mutating call and its
newly-added `logAudit` call move inside `withTransaction`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd warehouse-server && npx jest payroll.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/controllers/payrollController.ts warehouse-server/src/tests/payroll.test.ts
git commit -m "feat: audit-log all payroll mutations"
```

---

## Task 4: Instrument Warehouse Expenses (`createExpense`, `updateExpense`, `deleteExpense`)

**Files:**
- Modify: `warehouse-server/src/controllers/expenseController.ts`
  (`createExpense` lines 13-44, `updateExpense` lines 71-98,
  `deleteExpense` lines 100-122)
- Test: `warehouse-server/src/tests/expenses.test.ts` (existing file —
  add new `describe` blocks)

**Interfaces:**
- Consumes: `logAudit`/`AuditAction` from Task 1's `../utils/auditLog`.
- Consumes: `withTransaction` from `../db/dbUtils` (add to this file's
  existing `import { execute } from '../db/dbUtils';`).

- [ ] **Step 1: Write the failing tests**

Add to `expenses.test.ts` (extend its `../db/dbUtils` mock to also export
`withTransaction` per the Task 2 pattern):

```typescript
describe('warehouse expense audit logging', () => {
    it('createExpense logs a create row (before_value null, after_value the new row)', async () => { /* ... */ });
    it('updateExpense logs an update row (before_value the pre-edit row, after_value the post-edit row)', async () => { /* ... */ });
    it('deleteExpense logs a delete row (before_value the deleted row, after_value null)', async () => { /* ... */ });
    it('rolls back the insert if the audit insert fails (createExpense)', async () => { /* ... */ });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd warehouse-server && npx jest expenses.test.ts`
Expected: FAIL

- [ ] **Step 3: Convert all three handlers to `withTransaction` and add audit logging**

Add `withTransaction` to this file's `import { execute } from '../db/dbUtils';`
and add `import { logAudit } from '../utils/auditLog';`.

- `createExpense`: wrap the INSERT; `logAudit(exec, 'warehouse_expenses', result.rows[0].ID, 'create', userId, null, result.rows[0])` (`userId` is already computed in this handler).
- `updateExpense`: the existing pre-update existence SELECT only fetches `id` (line 77: `SELECT id FROM warehouse_expenses WHERE id = :id`) — change it to `SELECT * FROM warehouse_expenses WHERE id = :id` so the full pre-edit row is available as `before_value`, keep it on module-level `execute` before `withTransaction`; wrap the UPDATE in `withTransaction`; `logAudit(exec, 'warehouse_expenses', result.rows[0].ID, 'update', (req as any).user?.id ?? null, before, result.rows[0])` where `before` is that SELECT's row.
- `deleteExpense`: same existence-SELECT widening (`SELECT id` → `SELECT *`) kept on module-level `execute` before `withTransaction`; wrap the `DELETE FROM warehouse_expenses WHERE id = :id` in `withTransaction` using `exec`; `logAudit(exec, 'warehouse_expenses', Number(id), 'delete', (req as any).user?.id ?? null, before, null)`.

Keep each handler's existing scope checks, 404s, and the `23505` catch in
`createExpense` exactly as they are.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd warehouse-server && npx jest expenses.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/controllers/expenseController.ts warehouse-server/src/tests/expenses.test.ts
git commit -m "feat: audit-log warehouse expense create, update, and delete"
```

---

## Task 5: Instrument Staff (`createStaff`, `updateStaff`)

**Files:**
- Modify: `warehouse-server/src/controllers/staffController.ts`
  (`createStaff` lines 34-60, `updateStaff` lines 62-89)
- Test: `warehouse-server/src/tests/staff.test.ts` (existing file — add
  new `describe` blocks)

**Interfaces:**
- Consumes: `logAudit`/`AuditAction` from Task 1's `../utils/auditLog`.
- Consumes: `withTransaction` from `../db/dbUtils` (add to this file's
  existing `import { execute } from '../db/dbUtils';`).

- [ ] **Step 1: Write the failing tests**

Add to `staff.test.ts` (extend its `../db/dbUtils` mock to also export
`withTransaction` per the Task 2 pattern):

```typescript
describe('staff audit logging', () => {
    it('createStaff logs a create row (before_value null, after_value the new staff row)', async () => { /* ... */ });
    it('updateStaff logs an update row (before_value the pre-edit row, after_value the post-edit row)', async () => { /* ... */ });
    it('rolls back the insert if the audit insert fails (createStaff)', async () => { /* ... */ });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd warehouse-server && npx jest staff.test.ts`
Expected: FAIL

- [ ] **Step 3: Convert both handlers to `withTransaction` and add audit logging**

Add `withTransaction` to this file's `import { execute } from '../db/dbUtils';`
and add `import { logAudit } from '../utils/auditLog';`. Note the actor id
here must come from `(req as any).user?.id ?? null` — this file currently
has no `userId` variable in `createStaff`, unlike `expenseController.ts`.

- `createStaff`: wrap the INSERT in `withTransaction`; `logAudit(exec, 'staff', result.rows[0].ID, 'create', (req as any).user?.id ?? null, null, result.rows[0])`.
- `updateStaff`: the existing pre-update existence SELECT only fetches `id` (line 68: `SELECT id FROM staff WHERE id = :id`) — change it to `SELECT * FROM staff WHERE id = :id` so the full pre-edit row is available, keep it on module-level `execute` before `withTransaction`; wrap the UPDATE in `withTransaction`; `logAudit(exec, 'staff', result.rows[0].ID, 'update', (req as any).user?.id ?? null, before, result.rows[0])`.

Keep both handlers' existing scope checks and 404s exactly as they are.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd warehouse-server && npx jest staff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/controllers/staffController.ts warehouse-server/src/tests/staff.test.ts
git commit -m "feat: audit-log staff create and update"
```

---

## Task 6: Instrument Attendance (`bulkMarkAttendance`)

**Files:**
- Modify: `warehouse-server/src/controllers/attendanceController.ts`
  (`bulkMarkAttendance` lines 10-61 — already uses `withTransaction`, no
  conversion needed)
- Test: `warehouse-server/src/tests/attendance.test.ts` (existing file —
  add new `describe` block)

**Interfaces:**
- Consumes: `logAudit`/`AuditAction` from Task 1's `../utils/auditLog`.

- [ ] **Step 1: Write the failing test**

Add to `attendance.test.ts`:

```typescript
describe('bulkMarkAttendance audit logging', () => {
    it('logs one create row for a staff member with no prior record for that date, and one update row for a staff member with an existing record', async () => {
        // Arrange a batch of two entries. For staff_id 1, the per-entry pre-upsert
        // SELECT (added in Step 3) returns no row -> expect an audit_log INSERT
        // with action: 'create', before_value: null. For staff_id 2, that SELECT
        // returns an existing attendance row -> expect an audit_log INSERT with
        // action: 'update', before_value equal to that existing row.
        // Assert both audit_log inserts happened and each carries the correct
        // action/before_value independently (not just that two inserts occurred).
    });

    it('rolls back all upserts in the batch if one audit insert fails', async () => {
        // Arrange the second entry's audit_log insert to reject; assert the
        // endpoint returns a non-2xx response (the shared withTransaction rolls
        // back the whole batch, including the first entry's successful upsert).
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd warehouse-server && npx jest attendance.test.ts`
Expected: FAIL

- [ ] **Step 3: Add a per-entry pre-upsert lookup and audit logging inside the existing transaction**

Add `import { logAudit } from '../utils/auditLog';`. Inside the `for (const entry of entries)` loop (lines 33-49), before the existing `exec<any>(... INSERT ... ON CONFLICT ... DO UPDATE ...)` call, add a lookup for that staff member's existing record on that date:

```typescript
const existingResult = await exec<any>(
    `SELECT * FROM attendance WHERE staff_id = :staff_id AND attendance_date = :attendance_date`,
    { staff_id: entry.staff_id, attendance_date }
);
const before = existingResult.rows[0] ?? null;
```

Then, after the existing upsert's `results.push(upsertResult.rows[0]);`, add:

```typescript
await logAudit(
    exec,
    'attendance',
    upsertResult.rows[0].ID,
    before === null ? 'create' : 'update',
    (req as any).user?.id ?? null,
    before,
    upsertResult.rows[0]
);
```

This stays inside the existing `withTransaction(async (exec) => { ... })`
callback — no conversion needed since this handler already uses it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd warehouse-server && npx jest attendance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add warehouse-server/src/controllers/attendanceController.ts warehouse-server/src/tests/attendance.test.ts
git commit -m "feat: audit-log attendance upserts per staff member"
```

---

## Task 7: `GET /audit-log` read endpoint

**Files:**
- Create: `warehouse-server/src/controllers/auditLogController.ts`
- Create: `warehouse-server/src/routes/auditLogRoutes.ts`
- Create: `warehouse-server/src/schemas/auditLogSchemas.ts`
- Modify: `warehouse-server/src/app.ts` (add import + `app.use('/api/audit-log', auditLogRoutes);` after the existing `app.use('/api/payroll', payrollRoutes);` line)
- Test: `warehouse-server/src/tests/auditLog.test.ts` (Task 1's file — add
  route-level `describe` blocks alongside the existing `logAudit` unit
  tests, following the Supertest + mocked-`execute` pattern in
  `expenses.test.ts`)

**Interfaces:**
- Consumes: `execute` from `../db/dbUtils` (read-only endpoint, no
  transaction needed).
- Produces: `getAuditLog(req: Request, res: Response)` from
  `auditLogController.ts`, mounted at `GET /audit-log` via
  `auditLogRoutes.ts`, registered in `app.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// Added to warehouse-server/src/tests/auditLog.test.ts
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

jest.mock('../middleware/authMiddleware', () => ({
    authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
        (req as any).user = (req.headers['x-test-role'] ? { id: 1, role: req.headers['x-test-role'] } : { id: 1, role: 'system_admin' });
        next();
    },
}));
jest.mock('../db/dbUtils', () => ({ execute: jest.fn(), withTransaction: jest.fn() }));

import auditLogRoutes from '../routes/auditLogRoutes';
import { execute } from '../db/dbUtils';
const mockExecute = execute as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/audit-log', auditLogRoutes);

describe('GET /api/audit-log', () => {
    beforeEach(() => { mockExecute.mockReset(); });

    it('returns 403 for a finance_officer', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/api/audit-log').set('x-test-role', 'finance_officer');
        expect(res.status).toBe(403);
    });

    it('returns 403 for a warehouse_admin', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/api/audit-log').set('x-test-role', 'warehouse_admin');
        expect(res.status).toBe(403);
    });

    it('returns 200 with rows for a system_admin', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [{ ID: 1, TABLE_NAME: 'invoices', RECORD_ID: 7, ACTION: 'create' }] });
        const res = await request(app).get('/api/audit-log');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
    });

    it('filters by table_name and record_id', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });
        await request(app).get('/api/audit-log?table_name=invoices&record_id=7');
        const [query, params] = mockExecute.mock.calls[0];
        expect(query).toMatch(/AND al\.table_name = :table_name/);
        expect(query).toMatch(/AND al\.record_id = :record_id/);
        expect(params).toMatchObject({ table_name: 'invoices', record_id: '7' });
    });

    it('joins users to include the actor username', async () => {
        mockExecute.mockResolvedValueOnce({ rows: [] });
        await request(app).get('/api/audit-log');
        const [query] = mockExecute.mock.calls[0];
        expect(query).toMatch(/JOIN users/);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd warehouse-server && npx jest auditLog.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement the query schema in `auditLogSchemas.ts`**

```typescript
import { z } from 'zod';

export const auditLogQuerySchema = z.object({
    table_name: z.enum(['invoices', 'payroll', 'warehouse_expenses', 'staff', 'attendance']).optional(),
    record_id: z.string().regex(/^\d+$/, 'record_id must be numeric').optional(),
    actor_id: z.string().regex(/^\d+$/, 'actor_id must be numeric').optional(),
    from: z.string().optional(),
    to: z.string().optional(),
});
```

- [ ] **Step 4: Implement `getAuditLog` in `auditLogController.ts`**

```typescript
import { Request, Response } from 'express';
import { execute } from '../db/dbUtils';

export const getAuditLog = async (req: Request, res: Response) => {
    if ((req as any).user?.role !== 'system_admin') {
        return res.status(403).json({ message: 'Only system_admin may view the audit log' });
    }
    const { table_name, record_id, actor_id, from, to } = req.query;
    try {
        let query = `
            SELECT al.*, u.username AS actor_username, u.name AS actor_name
            FROM audit_log al
            LEFT JOIN users u ON u.id = al.actor_id
            WHERE 1=1
        `;
        const params: any = {};
        if (table_name) { query += ` AND al.table_name = :table_name`; params.table_name = table_name; }
        if (record_id) { query += ` AND al.record_id = :record_id`; params.record_id = record_id; }
        if (actor_id) { query += ` AND al.actor_id = :actor_id`; params.actor_id = actor_id; }
        if (from) { query += ` AND al.created_at >= :from`; params.from = from; }
        if (to) { query += ` AND al.created_at <= :to`; params.to = to; }
        query += ` ORDER BY al.created_at DESC LIMIT 500`;

        const result = await execute<any>(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('getAuditLog error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};
```

Check `users` table's actual column names (`username`, `name`) against
`warehouse-server/src/db/config.ts`'s `users` table definition before
finalizing the join's selected columns — adjust the `SELECT` list to match
whatever columns that table actually has.

- [ ] **Step 5: Implement `auditLogRoutes.ts`**

```typescript
import { Router } from 'express';
import { getAuditLog } from '../controllers/auditLogController';
import { authenticateToken } from '../middleware/authMiddleware';
import { validateQuery } from '../middleware/validationMiddleware';
import { auditLogQuerySchema } from '../schemas/auditLogSchemas';

const router = Router();

router.use(authenticateToken);
router.get('/', validateQuery(auditLogQuerySchema), getAuditLog);

export default router;
```

No `requirePermission(...)` middleware — the role gate is the explicit
check inside `getAuditLog` itself, per the spec's Decisions section.

- [ ] **Step 6: Register the route in `app.ts`**

Add `import auditLogRoutes from './routes/auditLogRoutes';` alongside the
other route imports, and `app.use('/api/audit-log', auditLogRoutes);`
after the existing `app.use('/api/payroll', payrollRoutes);` line.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd warehouse-server && npx jest auditLog.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add warehouse-server/src/controllers/auditLogController.ts warehouse-server/src/routes/auditLogRoutes.ts warehouse-server/src/schemas/auditLogSchemas.ts warehouse-server/src/app.ts warehouse-server/src/tests/auditLog.test.ts
git commit -m "feat: add GET /audit-log endpoint for system_admin"
```

---

## Task 8: Full suite run and live E2E verification

**Files:** none created or modified — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the full backend test suite**

Run: `cd warehouse-server && npx jest`
Expected: PASS, 0 failures, across every suite (not just the audit-log ones).

- [ ] **Step 2: Live E2E against the real database**

With the Docker Postgres container and the backend dev server running (per
this project's established dev setup), as `admin`/`password123`
(`system_admin`):

1. Create one invoice, create one expense entry, and mark attendance for
   at least one staff member (one new date, to get a `create` row).
2. Reverse the invoice just created.
3. Update the expense entry just created.
4. Call `GET /api/audit-log` and confirm: a row exists for each of the
   above actions with the correct `table_name`/`action`; the invoice's
   `create` row's `before_value` is `null` and `after_value` matches the
   created invoice; the invoice's `reverse` row's `before_value` matches
   the original invoice and `after_value` matches the reversal row; the
   expense's `update` row's `before_value`/`after_value` reflect the
   pre/post edit state.
5. Call `GET /api/audit-log` as a non-`system_admin` user (e.g.
   `staff1`/`password123`) and confirm a 403.

- [ ] **Step 3: Report results**

Summarize the full-suite run (pass count) and the live E2E findings before
considering this plan complete. Any discrepancy between what Step 2
observed and the spec's Endpoints-instrumented table is a bug, not a
plan deviation — fix it before marking this task done.
