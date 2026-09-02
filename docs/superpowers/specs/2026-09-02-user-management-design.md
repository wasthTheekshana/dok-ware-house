# DOK Warehouse System — User Management (Module 3)

## Context

The `users` table has existed since Module 1 (`id, username, password_hash,
name, role, status, created_at`, role in `admin`/`staff`), but the only way
to create a user is `warehouse-server/src/scripts/seed.ts`, which seeds a
single hardcoded `admin` account. There is no API or UI for creating,
editing, deactivating, or resetting the password of any user — every test
account so far (including the `staff1` account used to verify admin-gating
on Warehouses) had to be inserted directly via SQL. This module closes
that gap.

## Decisions

- **Admin-only account management, plus self-service password change.**
  `admin` can create/edit any user (name, role, status, and — as an admin
  override — reset their password directly, no current-password check).
  Any authenticated user, admin or staff, can change their *own* password
  via a separate endpoint that does require their current password.
- **Warehouse-agnostic roles, unchanged from today.** `admin`/`staff` stays
  a flat two-role system with no per-user warehouse scoping. If a future
  need arises for staff scoped to one warehouse, that is a separate,
  bigger feature — out of scope here.
- **Deactivate, never delete.** No `DELETE /api/users/:id` endpoint —
  matches every other entity in this app (Companies, Warehouses,
  Departments all use `status` toggling). Preserves the FK relationship
  from `box_events.created_by` and any future audit trail.
- **Last-active-admin guard.** This app has no "forgot password" recovery
  flow, so locking out every admin account would be unrecoverable without
  direct DB access. Any `PUT /api/users/:id` that would leave the system
  with zero active admins (by demoting the last active admin's role away
  from `admin`, or deactivating them) is rejected with 400.
- **No new tables or columns.** The existing `users` schema already has
  everything this module needs.

## API

All routes under `/api`, JWT-protected.

- `GET /users` (admin only) → list, `{ ID, USERNAME, NAME, ROLE, STATUS, CREATED_AT }` each, never `PASSWORD_HASH`
- `GET /users/:id` (admin only) → single user, same shape
- `POST /users` (admin only) → body `{ username, name, password, role }`; hashes password, `status` defaults `'active'`; 409 if `username` already taken
- `PUT /users/:id` (admin only) → body `{ name?, role?, status?, password? }` (all optional, at least one required, same `.refine()` pattern as `updateCompanySchema`); an included `password` is re-hashed and replaces the stored hash; before applying, if the target user is currently an active admin and the update would change `role` away from `'admin'` or `status` away from `'active'`, count other active admins — reject 400 (`"Cannot remove the last active admin"`) if that count is zero
- `POST /users/me/change-password` (any authenticated user) → body `{ current_password, new_password }`; loads the requesting user's own row (from the JWT's `id`), verifies `current_password` against the stored hash (401 if wrong), then hashes and stores `new_password`

## Frontend pages

- **Users** (new nav item, admin-only visibility like Warehouses) — list
  table (username, name, role badge, status badge) + create modal + edit
  modal (name, role, status, optional "New Password" field left blank to
  keep the current password).
- **Change Password** — not a nav page; a small modal opened from a new
  button in the `Layout` sidebar (near the existing Logout button),
  available to every logged-in user. Asks for current password + new
  password, calls `POST /users/me/change-password`.

## Testing

- Backend TDD: `userController` tests mirroring `warehouseController.test.ts`'s
  structure (list, detail, create incl. duplicate-username 409, update).
  Dedicated cases for the last-admin guard: rejects demoting the sole
  active admin's role, rejects deactivating the sole active admin, allows
  either when another active admin exists. Dedicated cases for
  `change-password`: rejects on wrong current password (401), succeeds
  and re-hashes on a correct one.
- Frontend: `npm run build` + a manual browser pass (this app's established
  convention — no frontend test suite exists anywhere in it).

## Out of scope (future sub-projects)

- Per-user warehouse scoping / restricted staff access
- Self-service "forgot password" / email-based recovery
- Permanent user deletion
- Invoicing/billing engine
- Warehouse daily expense report
