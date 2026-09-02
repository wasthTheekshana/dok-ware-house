# DOK Warehouse System — Customers & Box Inventory (Module 1)

## Context

DOK Solutions Lanka runs a physical records/document warehousing business
alongside the existing DOK-HR app (which only handles Sites/Staff/Tasks/
Payroll/Attendance). The actual warehouse operation — currently run entirely
through a set of monthly Excel workbooks in `docs/` — involves:

- Customers, many split into billing sub-accounts/departments (e.g.
  "AB SECURITAS - CASH DEPT", "AB SECURITAS - FINANCE DEPT")
- Monthly new boxes received/archived per department, with running
  accumulated totals
- Retrieval requests (customer asks for stored boxes back), currently
  billed with highly bespoke per-customer pricing rules
- Empty carton issuance, billed separately
- File/storage rental for some customers (recurring, e.g. NDB, HNB Finance)
- Monthly invoicing combining the above with SSCL/VAT tax
- Revenue and warehouse daily expense reporting

This is too large for a single build. This spec covers only the first,
foundational sub-project: **Customers & Box Inventory**. Billing/invoicing,
revenue reporting, and expense tracking are separate future sub-projects
that depend on this one existing first.

## Decisions

- **New, separate app** in this repo: `warehouse-server/` and
  `warehouse-client/`, alongside the existing `server/`/`client/`. Same
  stack conventions as DOK-HR (Node + Express + TypeScript backend, React +
  TypeScript + TailwindCSS frontend) but its own database and its own login
  — not integrated with DOK-HR's auth or schema.
- **Database: PostgreSQL** (not Oracle) — free, strong TypeScript tooling,
  easy local dev.
- **Own auth**: JWT + bcrypt, same pattern as DOK-HR's `authMiddleware`.
  Roles: `admin`, `staff`.
- **Company + Department two-level model**: a `companies` row is the legal
  customer entity; a `departments` row is the actual tracked/billed
  sub-account. Every box event attaches to a department, never directly to
  a company. This matches the real spreadsheets exactly (they always key
  off the sub-account, e.g. "ABS CASH DEPT", not just "AB Securitas").
- **Event types collapsed to three**: `archived`, `retrieved`,
  `empty_carton_issued`. The source spreadsheets have no "received but not
  yet archived" state — a box being received *is* what gets counted as
  newly archived that month — so there is no separate `received` event.
- **No individual box identity/barcodes in this module.** The current
  process tracks counts only (no per-box IDs anywhere in the source
  documents), so this module does the same. Individual box tracking is a
  possible future phase, not part of this spec.
- **Maintained running total**: `departments.current_box_count` is updated
  transactionally whenever an `archived` or `retrieved` event is inserted,
  rather than computed by summing full history on every read — this keeps
  dashboard/summary queries cheap as history grows.

## Data model

```sql
-- users
id              serial primary key
username        varchar(64) unique not null
password_hash   varchar(255) not null
name            varchar(200) not null
role            varchar(20) not null check (role in ('admin','staff'))
status          varchar(20) not null default 'active' check (status in ('active','inactive'))
created_at      timestamptz not null default now()

-- companies
id              serial primary key
name            varchar(200) not null
code            varchar(32) unique          -- short reference code, e.g. "ABS"
contact_person  varchar(200)
phone           varchar(64)
email           varchar(200)
address         text
status          varchar(20) not null default 'active' check (status in ('active','inactive'))
created_at      timestamptz not null default now()

-- departments
id                  serial primary key
company_id          integer not null references companies(id) on delete cascade
name                varchar(200) not null   -- e.g. "CASH DEPT"
code                varchar(32)             -- e.g. "AAC10" style site code, optional
status              varchar(20) not null default 'active' check (status in ('active','inactive'))
current_box_count   integer not null default 0
created_at          timestamptz not null default now()
unique (company_id, name)

-- box_events
id              serial primary key
department_id   integer not null references departments(id) on delete cascade
event_type      varchar(30) not null check (event_type in ('archived','retrieved','empty_carton_issued'))
quantity        integer not null check (quantity > 0)
event_date      date not null
reference_no    varchar(64)              -- e.g. "DOK/AOD/7835", "DOK/DRRF/KT/7297"
remarks         text
created_by      integer references users(id)
created_at      timestamptz not null default now()
```

`current_box_count` update rule (applied inside the same transaction as the
`box_events` insert):
- `archived` → `current_box_count += quantity`
- `retrieved` → `current_box_count -= quantity` (clamped, reject if it would
  go negative — data-entry error guard)
- `empty_carton_issued` → no change to `current_box_count` (it's a billable
  item, not a stored box)

## API

All routes under `/api`, JWT-protected except `/auth/login`.

- `POST /auth/login` → `{ token, user }`
- `GET /companies` → list with department count + total box count per company
- `POST /companies`, `PUT /companies/:id`
- `GET /companies/:id` → company + its departments (with `current_box_count` each)
- `POST /departments` (body includes `company_id`), `PUT /departments/:id`
- `POST /box-events` → creates event, updates department running total in
  the same DB transaction
- `GET /box-events?department_id=&event_type=&from=&to=` → paginated history
- `GET /summary/companies` → company-wise total boxes (mirrors "ALL COMPANY
  DOCUMENT BOXES INVOICING SUMMARY")
- `GET /summary/monthly?from=&to=` → monthly archived-box totals across the
  warehouse (mirrors "MONTHLY NEW BOXES RECEIVED SUMMARY")

## Frontend pages

- `Login`
- `Dashboard` — warehouse-wide current box total, this month's archived/
  retrieved/empty-carton counts, recent box events
- `Companies` — list + create/edit; click through to a company detail view
  showing its departments and per-department box counts
- `BoxEvents` — form to log a new archive/retrieve/empty-carton event
  against a department, plus a filterable history table
- `Reports` — company-wise box summary table, monthly trend chart
  (Recharts, matching DOK-HR's existing charting choice)

## Testing

- Unit tests for the running-total transition logic (archived/retrieved/
  empty-carton effect on `current_box_count`), including the negative-count
  guard — mirrors DOK-HR's existing `server/src/tests` pattern for
  `payrollUtils`.
- Integration test: POST a sequence of box-events for a department and
  assert `current_box_count` and `/summary/companies` reflect them
  correctly.

## Out of scope (future sub-projects)

- Billing/invoicing engine and per-customer pricing rules
- Revenue reporting
- Warehouse daily expense tracking
- Individual box identity/barcoding
- Any integration between this app and DOK-HR (shared login, shared staff
  data, etc.) — deliberately kept separate per current decision
