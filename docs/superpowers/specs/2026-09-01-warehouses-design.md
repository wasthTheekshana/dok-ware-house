# DOK Warehouse System — Warehouses (Module 2)

## Context

Module 1 (`docs/superpowers/specs/2026-08-24-warehouse-customer-box-inventory-design.md`)
built `companies`/`departments`/`box_events` tracking box counts, but has no
concept of a physical warehouse location at all. In reality DOK Solutions
operates multiple physical warehouses (e.g. "Dagonna"), and a customer's
departments can be split across 1-3 of them depending on the customer. This
is confirmed by two source spreadsheets in `docs/`:

- **"Warehouse Daily Expense Report"** — tracks daily expenses (Transport/
  Parking, Fuel, Labour, Meals & Refreshments, Other Expenses) per warehouse
  *location*, not per customer.
- **"ALL COMPANY DOCUMENT BOXES INVOICING SUMMARY"** — confirms the existing
  Company/Department/box-count model is otherwise correct.

This spec covers only the foundational piece: making **Warehouse** a
first-class entity and linking it to the existing model. Three further
sub-projects depend on this one and are out of scope here: **user
management**, **invoicing/billing**, and the **daily expense report**
itself (which needs warehouse-scoped expense entries — a separate module
once this one exists).

## Decisions

- **Per-department warehouse assignment.** A `departments` row gets a
  `warehouse_id` FK. A company naturally spans multiple warehouses when its
  departments are split across locations — this matches the existing
  box-tracking granularity (department, not company, is already the unit
  everything else keys off) and needs no change to `box_events`, since a
  box event's warehouse is implicit via its department.
- **`warehouse_id` is required (`NOT NULL`) on `departments`.** There is no
  production deployment of this app yet, so the column goes directly into
  the existing `CREATE TABLE IF NOT EXISTS departments (...)` statement —
  no live migration, no backfill, no nullable transition period.
- **Warehouse fields mirror Company's shape**: `name`, `code` (optional,
  unique), `address` (free text), `status`. Keeps the two "location-ish"
  entities in the app consistent.
- **Admin-only writes, same as Companies/Departments.** Any authenticated
  user can read the warehouse list (needed for the department-creation
  picker); only `admin` can create/edit a warehouse.
- **No cross-warehouse box movement in this module.** A department's
  `warehouse_id` is set at department-creation time. Moving a department's
  boxes to a different warehouse later (if that ever happens in practice)
  is out of scope — it would need its own transfer-event design.

## Data model

```sql
-- warehouses
id              serial primary key
name            varchar(200) not null      -- e.g. "Dagonna"
code            varchar(32) unique         -- short reference code, optional
address         text
status          varchar(20) not null default 'active' check (status in ('active','inactive'))
created_at      timestamptz not null default now()

-- departments (existing table, new column)
warehouse_id    integer not null references warehouses(id)
```

`departments.warehouse_id` has no `ON DELETE CASCADE` — a warehouse with
departments assigned to it cannot be deleted out from under them. (This
module doesn't add a delete endpoint for warehouses at all; only
create/edit, matching how Companies works today.)

## API

All routes under `/api`, JWT-protected, admin-only for writes.

- `GET /warehouses` → list with `department_count` per warehouse
- `GET /warehouses/:id` → warehouse + its departments (with company name,
  current box count each — mirrors `GET /companies/:id`'s shape)
- `POST /warehouses`, `PUT /warehouses/:id`
- `POST /departments` — body now requires `warehouse_id`; validation
  rejects the request if it's missing or doesn't reference an existing
  warehouse (same existence-check pattern already used for `company_id`)
- `GET /departments` and every endpoint that returns department rows
  (`GET /companies/:id`, `GET /box-events`, the department picker used by
  Box Events) now also returns `warehouse_id` and a joined `WAREHOUSE_NAME`

## Frontend pages

- **Warehouses** (new nav item) — list view (name, code, address, status,
  department count) + admin-only create/edit modal, mirroring the
  Companies page's structure exactly.
- **Company Detail** — the "New Department" form gains a required Warehouse
  dropdown (populated from `GET /warehouses`); the departments table gains
  a Warehouse column.
- **Box Events** — the department `<select>` options now show the
  warehouse name alongside the department name (e.g. "CASH DEPT — Dagonna
  (50)") so it's clear which location an event applies to.

## Testing

- Backend TDD: `warehouseController` tests (list, detail, create, update,
  admin-gated, mirroring `companyController.test.ts`'s structure) plus
  updates to `departmentController` tests covering the now-required
  `warehouse_id` (missing → 400, non-existent → 400, matching the existing
  `company_id` existence-check test).
- Frontend: verified via `npm run build` (no TypeScript errors) plus a
  manual pass in the browser — this project has no frontend test suite
  anywhere, so this matches the established convention rather than
  introducing a new one.

## Out of scope (future sub-projects)

- User management (staff/admin account CRUD)
- Invoicing/billing engine
- Warehouse daily expense report (needs its own `warehouse_expenses` table,
  built on top of this module's `warehouses` entity)
- Cross-warehouse box transfers
- Per-warehouse pricing or cost differences
