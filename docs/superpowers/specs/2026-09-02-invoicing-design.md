# DOK Warehouse System — Invoicing (Module 4)

## Context

DOK currently invoices customers by hand, one Excel workbook per month
(`Invoice - Advice DOK JULY 2026 -.xlsm`), with a summary sheet plus one
sheet per customer site. Real invoices show:

- Line items per box lifecycle event: archived boxes, retrieved boxes,
  empty cartons issued — each at its own per-unit price, sometimes tiered
  by volume (e.g. 1000+ boxes/month = Rs. 45/box vs. Rs. 50/box under
  1000).
- Two stacked taxes: SSCL (~2.5641%) applied to the box-charge subtotal,
  then VAT (18%) applied to the SSCL-inclusive amount.
- Billing is per department/site (e.g. "ABS CASH" and "ABS FINANCE" are
  separate line items on separate sheets, even though both belong to AB
  Securitas) — matching this app's existing department-as-billing-unit
  model.

This spec covers a deliberately reduced first version: flat (non-tiered)
per-department pricing, computed and saved per department per period.
Tiered/volume pricing is out of scope until real usage shows it's needed.

## Decisions

- **Flat per-department pricing**, stored directly as three new nullable
  numeric columns on `departments`: `price_per_archived_box`,
  `price_per_retrieved_box`, `price_per_empty_carton` (all default `0`).
  No tiered/volume pricing in this version.
- **Per-department invoices**, matching the real Excel sheets and this
  app's existing billing-unit model — never rolled up to company level.
- **Preview + Save**, mirroring the existing DOK-HR app's invoicing
  pattern: `POST /invoices/preview` computes and returns a breakdown
  without persisting anything; `POST /invoices` recomputes the same way
  and persists a snapshot. The save endpoint never trusts client-submitted
  amounts — it always recomputes server-side from `box_events` and the
  department's current prices, using only `department_id`/`period_from`/
  `period_to` from the request body.
- **Saved invoices are immutable** — no `PUT /invoices/:id`. To correct a
  mistake, delete (`DELETE /invoices/:id`, admin-only) and regenerate.
  This matches how a financial record should behave (no silent edits),
  unlike master-data entities elsewhere in this app that use a
  `status` toggle instead of deletion.
- **Tax rates are environment-configured constants**
  (`SSCL_RATE`, `VAT_RATE`), not stored per-invoice or editable through
  the UI — same pattern as this app's existing `EXTRA_UNIT_RATE`-style
  config. Defaults: `SSCL_RATE=0.025641` (≈2.5641%, matches the real
  workbook), `VAT_RATE=0.18` (18%).
- **Tax stacking order matches the real invoices**: `subtotal` = sum of
  (count × price) for each event type; `sscl_amount = subtotal * SSCL_RATE`;
  `vat_amount = (subtotal + sscl_amount) * VAT_RATE`; `total_amount =
  subtotal + sscl_amount + vat_amount`.

## Data model

```sql
-- departments (existing table, new columns)
price_per_archived_box    numeric(12,2) not null default 0
price_per_retrieved_box   numeric(12,2) not null default 0
price_per_empty_carton    numeric(12,2) not null default 0

-- invoices
id                     serial primary key
department_id          integer not null references departments(id)
company_id             integer not null references companies(id)
department_name        varchar(200) not null   -- denormalized snapshot
company_name            varchar(200) not null   -- denormalized snapshot
period_from             date not null
period_to               date not null
archived_count          integer not null default 0
retrieved_count         integer not null default 0
empty_carton_count      integer not null default 0
price_per_archived_box  numeric(12,2) not null   -- snapshot of the price used
price_per_retrieved_box numeric(12,2) not null
price_per_empty_carton  numeric(12,2) not null
subtotal                numeric(14,2) not null
sscl_amount             numeric(14,2) not null
vat_amount              numeric(14,2) not null
total_amount            numeric(14,2) not null
created_at              timestamptz not null default now()
created_by              integer references users(id)
```

No `ON DELETE CASCADE` on `department_id`/`company_id` — an invoice is a
financial record and should not silently disappear if a department is
later deactivated (departments are deactivated, never deleted, so this
is largely theoretical, but the FK stays protective rather than cascading).

## API

All routes under `/api`, JWT-protected, admin-only for every route in
this module (invoicing is sensitive financial data — even reads).

- `PUT /departments/:id` (existing route) — schema extended to accept
  `price_per_archived_box`/`price_per_retrieved_box`/`price_per_empty_carton`
  as optional numeric fields alongside the existing editable fields.
- `POST /invoices/preview` → body `{ department_id, period_from, period_to }`
  → full breakdown (counts, prices used, subtotal, sscl_amount, vat_amount,
  total_amount) computed live — nothing persisted.
- `POST /invoices` → same body shape → recomputes identically and inserts
  a row; returns the saved invoice.
- `GET /invoices?department_id=&company_id=&from=&to=` → filtered list,
  newest first.
- `DELETE /invoices/:id` → removes the row.

## Frontend pages

- **Company Detail** — the departments table gains an inline edit
  (pencil icon, same interaction pattern as the Box Events history
  table's inline edit) for the three price fields.
- **Invoices** (new nav item, admin-only visibility) — company →
  department cascading pickers (same pattern as the Box Events page),
  a date range, "Preview" (renders the full breakdown), and "Save
  Invoice". Below: a history table of previously saved invoices,
  filterable by department.

## Testing

- Backend TDD: a pure `computeInvoiceAmounts(archivedCount, retrievedCount,
  emptyCartonCount, prices, ssclRate, vatRate)` function (mirrors
  `boxCount.ts`'s approach — TDD'd standalone before any controller code),
  covering the tax-stacking math precisely (SSCL on subtotal, VAT on
  SSCL-inclusive amount) and the zero-price/zero-count edge cases.
  `invoiceController` tests (preview, save-recomputes-not-trusts-client,
  list with filters, delete) mirroring the existing `warehouseController`/
  `boxEventController` test patterns, all admin-gated with the same
  real-`requireRole` dynamic-mock test already established in this
  codebase.
- Frontend: `npm run build` + a manual browser pass — this app's
  established convention, no frontend test suite exists.

## Out of scope (future sub-projects)

- Tiered/volume-based pricing
- PDF or printable invoice generation/export
- Warehouse daily expense report (still pending, separate module)
- Editing a saved invoice (delete + regenerate only)
- Per-invoice tax rate overrides (e.g. tax-exempt customers)
