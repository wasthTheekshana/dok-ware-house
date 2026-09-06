# DOK Warehouse System — Payroll Processing & Approval (Module 8)

## Context

`docs/WMS_SRS_DOK_Solutions.docx` (WMS-SRS-2026-001) specifies FR-24 (Payroll
Processing), FR-25 (Payroll Approval Workflow), FR-26 (Consolidated Payroll
Report), and UC-7 (Process Monthly Payroll) — the third and final piece of
Phase 2's "Staff/Attendance/Payroll" scope. It depends directly on Module 7
(Staff Master & Attendance): UC-7's precondition is "attendance for the
month is finalised for all staff in the warehouse," and its pre-fill step
("system pre-fills basic salary and attendance-based deductions/OT")
consumes the `GET /attendance/summary` endpoint Module 7 already built.

This module also implements, for the first time in this codebase, the
SRS's immutability rule (NFR, line 266): "financial and payroll records
shall become immutable once ... a payroll run is Approved; corrections
thereafter shall be made via reversal entries, never by silent edit or
deletion." The existing Invoices module does not yet follow this rule (it
still supports a hard `DELETE` at any status) — that is a known, separate,
already-tracked gap this module does not fix. Payroll is built to the
SRS's actual rule from the start, since it has no legacy behavior to be
consistent with.

## Decisions

- **Workflow states**: `draft` → `pending_approval` → `approved` /
  `rejected`. A `rejected` run is editable again (treated like `draft`) so
  the `warehouse_admin` can revise and resubmit. Once `approved`, no edit
  or delete endpoint in this module will ever touch that row — the ONLY
  way to change an approved run's numbers is the reversal mechanism below.
- **Reversal, not edit-in-place, for approved corrections.** `POST
  /payroll/:id/reverse` (approver roles only) creates a brand-new row that
  is the exact negative mirror of the approved original (same `staff_id`/
  `month`/`year`, every amount field negated), linked via a
  `reverses_payroll_id` FK back to the original. The original row is never
  modified. A genuinely corrected payroll for that staff/month is then a
  separate, fresh `draft` created and approved through the normal workflow
  — the consolidated report's monthly sum naturally nets the reversal
  against the original, and nets in the new corrected figure once that's
  approved too.
- **`manage_payroll` permission key**, granted by role default to
  `warehouse_admin` (create/edit/submit within their own warehouse only)
  AND `system_admin`/`finance_officer` (approve/reject/reverse, plus the
  consolidated report) — matching FR-25's literal "System Administrator/
  Finance" wording and `finance_officer`'s existing ownership of
  Invoicing. `warehouse_admin` cannot approve/reject/reverse anything,
  including their own submissions — enforced at the controller level, not
  just by role default, since a `system_admin` could in principle grant a
  `warehouse_admin` the same key via override and the approve/reject/
  reverse handlers must still separately verify the actor isn't the
  submitter's own warehouse-admin role for that action. (In practice this
  reduces to: approve/reject/reverse handlers additionally require the
  actor's role to be `system_admin` or `finance_officer`, checked
  explicitly in the handler — not derived from the single shared
  permission key alone, since the key is shared across both "prepare" and
  "approve" capabilities by design.)
- **Pre-fill from attendance, not free-text from scratch.** Creating a
  draft for a given `staff_id`/`month`/`year` calls the existing `GET
  /attendance/summary` endpoint (Module 7) to fetch that staff member's
  day-counts for the month, then pre-fills:
  - `basic_pay` = the staff member's current `basic_salary`.
  - `deductions` = `(basic_salary / 30) × absent_days` — a simple
    per-calendar-day rate times the attendance summary's `absent` count.
    This is a suggested starting value, not a locked calculation — UC-7
    explicitly says the `warehouse_admin` "reviews and adjusts figures."
  - `ot_amount` defaults to `0` and stays a free-entry field. Attendance
    records a status and optional in/out times, not worked hours, so
    there is no data source in this app to auto-compute overtime pay —
    building one would require inventing an hours-based OT-rate model the
    SRS never specifies. Manual entry is the honest reflection of what
    data actually exists.
  - `epf_employee`, `epf_employer`, `etf` are entered directly (standard
    Sri Lankan statutory rates — 8%/12%/3% of basic pay — are common
    defaults the frontend can suggest, but the fields stay editable
    numbers, not hardcoded percentages, since rates can change by law).
  - `net_salary` = `basic_pay + ot_amount − deductions − epf_employee`
    (the employee's actual take-home). `epf_employer` and `etf` are
    employer-side costs, tracked for the consolidated report's total-cost
    figure but never subtracted from the employee's net.
- **Consolidated report (FR-26) sums only `approved` rows** (including
  reversals, which are also `approved` by construction — a reversal is
  auto-approved immediately since it only exists to correct an
  already-approved figure, not to be reviewed again), per warehouse per
  month, reporting both the employee-side total (`SUM(net_salary)`) and
  the employer's full cost (`SUM(net_salary + epf_employer + etf)`).
  Unscoped for `system_admin`/`finance_officer`; a `warehouse_admin` who
  somehow reaches this endpoint sees only their own warehouse's row (same
  scoping mechanism as every other module).

## Data model

```sql
CREATE TABLE IF NOT EXISTS payroll (
    id                  INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    staff_id            INTEGER NOT NULL REFERENCES staff(id),
    warehouse_id        INTEGER NOT NULL REFERENCES warehouses(id),
    month               INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    year                INTEGER NOT NULL,
    basic_pay           NUMERIC(12,2) NOT NULL DEFAULT 0,
    ot_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
    deductions          NUMERIC(12,2) NOT NULL DEFAULT 0,
    epf_employee        NUMERIC(12,2) NOT NULL DEFAULT 0,
    epf_employer        NUMERIC(12,2) NOT NULL DEFAULT 0,
    etf                 NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_salary          NUMERIC(12,2) NOT NULL DEFAULT 0,
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','pending_approval','approved','rejected')),
    reverses_payroll_id INTEGER REFERENCES payroll(id),
    created_by          INTEGER REFERENCES users(id),
    approved_by         INTEGER REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (staff_id, month, year, reverses_payroll_id)
);
```

The unique constraint includes `reverses_payroll_id` (rather than plain
`UNIQUE (staff_id, month, year)`) specifically so a reversal row — which
shares the same `staff_id`/`month`/`year` as the row it reverses — doesn't
collide with the original; two ordinary (non-reversal) drafts for the same
staff/month still collide correctly since `reverses_payroll_id` is `NULL`
for both and Postgres treats `NULL`s as distinct in a unique constraint,
which is exactly wrong here — **this needs the application layer to also
enforce "at most one non-reversal row per (staff_id, month, year)"
explicitly in `createPayroll`**, since the DB constraint alone won't catch
two plain drafts (both with `reverses_payroll_id IS NULL`). Call this out
explicitly in the plan as a check the create-handler must perform via a
`SELECT` before insert, not rely on the constraint alone.

`warehouse_id` is denormalized onto `payroll` (rather than joined via
`staff.warehouse_id` on every query) to make every scoped query a direct
`AND warehouse_id = ANY(:warehouse_ids)`, matching the same pattern
already used on `box_events`/`warehouse_expenses`/`attendance` — though
note `attendance` did NOT denormalize `warehouse_id` and instead joins to
`staff`; this module chooses to denormalize because payroll rows are
referenced by an approval workflow across multiple endpoints where the
extra join would be repeated more often. This is a one-time judgment call
kept consistent within this table, not a hard rule for future tables.

## API

- `POST /payroll` — create a `draft` for `{staff_id, month, year}`,
  pre-filled from `GET /attendance/summary` as described above. 409 if a
  non-reversal row already exists for that staff/month (checked in the
  handler, not solely by the DB constraint — see Data Model note above).
  A `warehouse_admin` may only create for staff within their own scope.
- `PUT /payroll/:id` — edit a `draft`/`rejected` row's amount fields. 404
  if the row doesn't exist, is outside the requester's scope, or is
  `approved`/`pending_approval` (an approved or in-review row is never
  edited — return the same 404 a scoped-out row would, not a distinguishing
  403, matching this app's established "don't confirm what you can't
  touch" convention).
- `POST /payroll/:id/submit` — `draft`/`rejected` → `pending_approval`.
  Same scope/status rules as `PUT`.
- `POST /payroll/:id/approve` — `pending_approval` → `approved`. Requires
  the actor's role to be `system_admin` or `finance_officer` (checked
  explicitly, not solely via `manage_payroll`, per the Decisions section).
  Sets `approved_by`.
- `POST /payroll/:id/reject` — `pending_approval` → `rejected`. Same role
  check as approve.
- `POST /payroll/:id/reverse` — only valid on an `approved`, non-reversal
  row (400 if targeting a draft/pending/rejected/already-a-reversal row).
  Same role check as approve. Inserts the negative-mirror row, `status:
  'approved'` immediately (a reversal needs no separate re-approval — it
  exists only because something was already approved).
- `GET /payroll?staff_id=&month=&year=&status=` — list, warehouse-scoped.
- `GET /payroll/report?year=&month=` — consolidated cross-warehouse cost
  report, per Decisions above.
- All routes behind `router.use(authenticateToken);
  router.use(requirePermission('manage_payroll'));`, matching this app's
  established whole-router-gate pattern; the extra role check for
  approve/reject/reverse happens inside those three handlers specifically.

## Frontend

- New nav item "Payroll", gated on `manage_payroll`.
- `pages/Payroll.tsx`: for `warehouse_admin` — a staff/month picker that
  loads (or creates, pre-filled) that staff member's draft, an editable
  amount form, and a "Submit for Approval" action; a list of their
  warehouse's payroll rows with status badges. For `system_admin`/
  `finance_officer` — the same list unscoped (or filtered by warehouse),
  with Approve/Reject/Reverse actions on `pending_approval`/`approved`
  rows respectively, plus the Consolidated Report view (per-warehouse
  monthly totals, employee-side and employer-cost columns).
- Warehouse-scoped picker logic reuses the corrected `isScoped`/
  `selectableWarehouses` pattern already fixed in `Expenses.tsx`/
  `Staff.tsx`/`Attendance.tsx` in this same codebase — including the
  single-warehouse auto-select fix from that fix wave (auto-select
  whenever the selectable set has exactly one entry, regardless of role).

## Testing

- Backend: standard controller/route test suite following this app's
  established pattern — mocked `execute`/`withTransaction`, permission-
  gating tests using the real `requirePermission` middleware, warehouse-
  scoping tests for every endpoint mirroring the Staff/Attendance
  precedent.
- Specific correctness tests this module needs beyond the established
  pattern: (a) the create-handler's application-level duplicate check
  (a second `POST /payroll` for the same staff/month/non-reversal is
  rejected even though the DB constraint alone wouldn't catch it); (b) the
  full status-transition matrix (draft→pending_approval→approved is
  allowed; approved→anything via PUT/submit is rejected; rejected→
  pending_approval is allowed); (c) a `warehouse_admin` with `manage_payroll`
  cannot call approve/reject/reverse even though they hold the permission
  key (the explicit role check inside those three handlers); (d) the
  reversal's negative-mirror math (every amount field negated, `net_salary`
  correctly negative); (e) the consolidated report correctly nets an
  approved row against its reversal to zero for that staff/month.
- Manual E2E verification against the real database (this app's
  established final-task pattern): full lifecycle as `warehouse_admin`
  (create pre-filled draft → adjust → submit) then as `system_admin`
  (approve), confirm the consolidated report reflects it, reverse it as
  `finance_officer`, confirm the report nets back to zero for that
  staff/month, confirm a `warehouse_admin` gets 403 attempting to approve
  their own submission.

## Out of scope (future/separate work)

- Fixing Invoices' own immutability gap (hard `DELETE` at any status) —
  a separate, already-tracked issue, not addressed by this module.
- Payslip document generation/export ("payslips become available" per
  UC-7's postcondition) — this module produces the approved payroll
  record; a printable/exportable payslip view is a follow-on, not blocking
  the approval workflow itself.
- Automatic overtime-hours calculation from attendance in/out times — no
  data model change to attendance is made here; OT stays manually entered.
- Historical import — this module starts empty, matching every prior
  module in this app.
