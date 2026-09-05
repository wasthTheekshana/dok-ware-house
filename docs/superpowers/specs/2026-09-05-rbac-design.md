# DOK Warehouse System — Warehouse-Scoped RBAC (Module 5)

## Context

`docs/WMS_SRS_DOK_Solutions.docx` (WMS-SRS-2026-001, v1.0, 5 September 2026)
is the formal requirements document this project is now building against.
It specifies three warehouses (Mt. Lavinia, Dagonna, Kotugoda) and three
user roles — **System Administrator** (full cross-warehouse visibility),
**Warehouse Administrator** (day-to-day operations for their own warehouse
only), and **Finance/Billing Officer** (invoicing and rate cards) — with
every warehouse-scoped query filtered server-side on the acting user's
assigned warehouse (FR-27, FR-28, FR-29; architecture section 6.1).

Every module built so far (Companies, Warehouses, Departments, Box Events,
Users, Invoices) uses a flat `admin`/`staff` role with no warehouse
scoping at all — `admin` can touch everything everywhere, `staff` can log
box events everywhere. This module replaces that with the SRS's 3-role,
warehouse-scoped model, plus a per-user permission-override layer the user
asked for on top of it (a `system_admin` should be able to grant or revoke
an individual capability for one specific user, beyond what their role
would normally allow).

This module is the RBAC *foundation* only — it does not build the
individual-box-lifecycle, disposal, storage-rental, expense-tracking, or
HR/attendance/payroll features the SRS also calls for (those are separate,
later modules). It retrofits scoping onto every existing module.

## Decisions

- **Three roles replace `admin`/`staff` entirely**: `system_admin`,
  `warehouse_admin`, `finance_officer`. The existing `role` CHECK
  constraint on `users` is widened to these three values; `admin`/`staff`
  are no longer valid values going forward (see Migration below).
- **Warehouse scoping via `users.warehouse_ids` (integer array).** A
  `warehouse_admin` is scoped to the warehouse(s) listed there (usually
  one, but the array allows covering more than one). `system_admin` and
  `finance_officer` are unscoped by role — an empty array means "all
  warehouses" for them, since neither role is warehouse-restricted per
  the SRS.
- **Fixed permission keys, one per existing capability**:
  `manage_companies`, `manage_warehouses`, `manage_box_events`,
  `view_invoices`, `manage_invoices`, `manage_users`. Each role has a
  hardcoded default set (in code, not the database):
  - `system_admin`: all six keys.
  - `warehouse_admin`: `manage_box_events` only.
  - `finance_officer`: `view_invoices`, `manage_invoices` only.
- **Per-user permission overrides layered on top of role defaults.** A new
  `user_permission_overrides` table (`user_id`, `permission_key`,
  `granted`) lets `system_admin` grant a key a role wouldn't normally
  carry, or revoke one it would. No override row for a given key means
  "use the role default." This is the mechanism, not a replacement for
  roles — roles still set sensible defaults for the common case.
- **Companies/Departments stay System-Administrator-owned master data**
  (`manage_companies`), matching FR-1 exactly — a `warehouse_admin` never
  creates or edits a company/department, only reads the ones with a
  department in their scope (needed to pick a department when logging a
  box event).
- **Box events are the only fully warehouse-scoped resource in this
  module.** `manage_box_events` is checked, AND the acting user's
  `warehouse_ids` (unless `system_admin`) filters which departments they
  can act on — enforced in the SQL `WHERE` clause of every box-event
  query, never only hidden in the UI, matching this app's existing
  server-side-enforcement convention.
- **Invoicing moves from "admin-only" to `finance_officer`+`system_admin`
  only**, per FR-14/UC-4 assigning invoice generation to the Finance/
  Billing Officer, not the Warehouse Administrator. A `warehouse_admin`
  has no invoice access by default (can be granted `view_invoices` via an
  override if a specific person needs it).
- **User management stays `system_admin`-only** (`manage_users`) —
  unchanged from today.
- **The frontend receives an `effective_permissions` array at login**,
  computed server-side with the same role-default-plus-override logic the
  backend middleware uses, so the UI's button/nav-gating logic and the
  API's actual enforcement can never drift apart into two different
  answers for "can this user do X."

## Data model

```sql
-- users (existing table)
-- Widen the role CHECK constraint:
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('system_admin', 'warehouse_admin', 'finance_officer'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS warehouse_ids INTEGER[] NOT NULL DEFAULT '{}';

-- user_permission_overrides
id              serial primary key
user_id         integer not null references users(id) on delete cascade
permission_key  varchar(50) not null check (permission_key in (
                    'manage_companies', 'manage_warehouses', 'manage_box_events',
                    'view_invoices', 'manage_invoices', 'manage_users'
                ))
granted         boolean not null
created_at      timestamptz not null default now()
unique (user_id, permission_key)
```

`warehouse_ids` references no FK (Postgres arrays can't FK directly) —
validity is checked at write time in `updateUser`/`createUser`, the same
way `company_id`/`warehouse_id` existence is already checked elsewhere in
this app.

## API

- `POST /auth/login` response's `user` object gains `WAREHOUSE_IDS` and
  `EFFECTIVE_PERMISSIONS` (a string array) alongside the existing fields.
- A new `requirePermission(key: PermissionKey)` middleware
  (`middleware/permissionMiddleware.ts`) replaces every `requireRole(['admin'])`
  call in `companyRoutes.ts`, `warehouseRoutes.ts`, `boxEventRoutes.ts`,
  `invoiceRoutes.ts`, `userRoutes.ts`. It reads `req.user.id`/`req.user.role`
  (from the JWT) plus a DB lookup of that user's overrides, computes the
  effective permission, and 403s if false.
- Box event routes additionally apply a `scopeToWarehouse` check: for a
  `warehouse_admin`, every box-event query's `WHERE` clause is extended
  with `department_id IN (SELECT id FROM departments WHERE warehouse_id = ANY(:warehouse_ids))`;
  `system_admin` (and `finance_officer`, who has no box-event access
  anyway) bypass this filter entirely.
- `GET /companies`, `GET /companies/:id`, `GET /departments` apply the
  same warehouse filter for a `warehouse_admin` (via each department's
  `warehouse_id`), rather than requiring a permission key — these stay
  open-read for every role, just narrowed by scope.
- `PUT /users/:id` accepts an optional `warehouse_ids: number[]` and an
  optional `permission_overrides: {key: PermissionKey, granted: boolean}[]`
  — the latter replaces that user's full override set on each update
  (simplest semantics: the request body is the new source of truth for
  overrides, not a diff).
- The existing `wouldRemoveLastAdmin` guard (Module 3) is renamed in
  spirit but not code — it already operates on `role === 'admin' && status
  === 'active'`; this module updates it to check `role === 'system_admin'`
  instead, preserving the same "never leave zero active admins" protection
  under the new role name.

## Frontend

- `AuthContext`'s `WhUser` type gains `WAREHOUSE_IDS: number[]` and
  `EFFECTIVE_PERMISSIONS: string[]`.
- Every existing `user?.ROLE === 'admin'` check in the frontend (Layout's
  Users/Invoices nav items, Warehouses'/CompanyDetail's "New ..." buttons,
  Users.tsx's/Invoices.tsx's page-level access guard) is replaced with an
  `effective_permissions.includes('<key>')` check against the
  corresponding permission key.
- The Users page's create/edit form: the role `<select>` offers the three
  new role values; a warehouse multi-select appears only when
  `role === 'warehouse_admin'`; a small "Permission Overrides" section
  lists the six permission keys, each as a 3-way toggle (Default / Always
  Allow / Always Deny) reflecting and writing `permission_overrides`.

## Migration

There is no production deployment and only a handful of test accounts
(`admin`, `staff1`, `staff2`). The migration is a one-time manual data fix,
run once after this module's schema changes are deployed:
```sql
UPDATE users SET role = 'system_admin' WHERE role = 'admin';
UPDATE users SET role = 'warehouse_admin', warehouse_ids = '{1}' WHERE role = 'staff';
```
(Warehouse `1` is whatever warehouse exists in the target environment at
the time — this is a manual `psql` step documented in the plan, not
application code, since it only needs to run once and touches no more
than a few rows.)

## Testing

- Backend TDD: a pure `computeEffectivePermissions(role, overrides:
  {key, granted}[]): string[]` function (mirrors this app's established
  pure-function-first pattern), covering role defaults, a grant-override,
  a revoke-override, and both together.
- `permissionMiddleware.ts` tests mirroring the existing `requireRole`
  test pattern: 403 when the effective permission is false, next() when
  true, exercising both the role-default path and an override path.
- Warehouse-scoping tests on box events: a `warehouse_admin` gets 0 rows
  querying another warehouse's department, a full result querying their
  own; `system_admin` gets everything regardless.
- Frontend: `npm run build` + a manual browser pass, matching this app's
  established convention.

## Out of scope (future modules)

- Individual box lifecycle, disposal workflow (FR-4/5/6)
- Storage rental billing (FR-11)
- Batch monthly invoicing across all customers, invoice status/export
  (FR-14/16/17)
- Warehouse daily expense tracking (FR-18/19/20)
- Staff/attendance/payroll (FR-21–26) — the actual HR module this RBAC
  foundation exists to support
- Audit trail (FR-30)
- Executive dashboards, barcode scanning, DOK-HR integration (Phase 3)
