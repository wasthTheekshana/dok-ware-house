# DOK Warehouse System — Storage Rental Auto-Calculation

## Context

`docs/WMS_SRS_DOK_Solutions.docx` specifies FR-11: "The system shall
auto-calculate each customer's monthly storage rental from the current
box count held and the applicable rate card, supporting split rates (e.g.
a standard box rate and a separate file-storage rate, as currently used
for HNB Finance and NDB)."

Invoicing today (the Invoices module) bills purely off `box_events`
transaction counts within a period — archived boxes × rate, retrieved
boxes × rate, empty cartons issued × rate. There is no recurring charge
for boxes simply sitting in storage. FR-11 adds that recurring rental
component as a new line item on the same invoice.

This module builds directly on the Invoices reversal/immutability work
already shipped (`reverses_invoice_id`, partial unique index) — the new
rental fields follow that same "snapshot at creation, never edited,
negated on reversal" discipline.

## Decisions

- **Reuse departments as the rate-card unit.** Departments already carry
  `price_per_archived_box`, `price_per_retrieved_box`,
  `price_per_empty_carton` as the per-customer rate card. Storage rental
  adds a fourth field, `price_per_box_stored_monthly`, to the same table.
  FR-11's "split rates" (e.g. HNB Finance's standard box rate vs. its
  separate file-storage rate) are modeled as two department rows for that
  customer with different `price_per_box_stored_monthly` values — this
  already works today for archived/retrieved/carton rates and needs no
  new entity for rental.
- **Rental basis is the live `current_box_count`, not a historical
  reconstruction.** `departments.current_box_count` is a running total,
  not indexed by date. FR-11 says "current box count held," and in
  practice invoices are generated for the current or just-closed month,
  not arbitrary back-dated periods — so `computeBreakdown` reads the
  department's `current_box_count` at the moment the invoice is
  generated. Reconstructing a count as of `period_to` by replaying
  `box_events` is explicitly out of scope (see below).
- **Flat monthly charge, no proration.** `storage_rental_amount =
  current_box_count × price_per_box_stored_monthly`, applied once per
  invoice regardless of how many days `period_from..period_to` spans.
  Invoices are used monthly in practice; proration by period length is
  not something the SRS describes or this system currently needs.
- **Default rate is 0.** Every existing department gets
  `price_per_box_stored_monthly = 0` on migration, so no customer starts
  being charged rent until a rate is explicitly configured. Non-breaking
  for every invoice generated before this feature existed.
- **Persisted on the invoice row, following the existing snapshot
  pattern.** `invoices` gains two columns: `box_count_at_billing`
  (informational — the box count used for this specific invoice) and
  `storage_rental_amount` (a real monetary line, included in `subtotal`
  the same way the other three line amounts already are). Both are
  computed once at `createInvoice` time and never recomputed — matching
  how `archived_count`/`subtotal`/etc. are already frozen at creation.
- **Reversal behavior**: `reverseInvoice` copies `box_count_at_billing`
  from the original unchanged (it's a fact about what the original
  invoice billed, not a delta to invert) and negates
  `storage_rental_amount` exactly like it already negates `subtotal`,
  `sscl_amount`, `vat_amount`, and `total_amount`.

## Data model

```sql
-- departments: add the fourth rate-card field
ALTER TABLE departments
    ADD COLUMN IF NOT EXISTS price_per_box_stored_monthly NUMERIC(12,2) NOT NULL DEFAULT 0;

-- invoices: add the rental snapshot + amount
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS box_count_at_billing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS storage_rental_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
```

Both are additive `DEFAULT`-bearing columns — safe on existing rows,
consistent with every prior migration in this app (idempotent, run in any
order, no data migration needed since the default correctly represents
"no rental" for pre-existing invoices).

## API

- `computeBreakdown` (internal to `invoiceController.ts`) now also
  selects `d.current_box_count, d.price_per_box_stored_monthly` and
  computes `storageRentalAmount = current_box_count *
  price_per_box_stored_monthly`. This is added into `computeInvoiceAmounts`
  (`invoiceCalc.ts`) as a fourth pre-tax term, so SSCL/VAT are computed on
  the combined subtotal (archived + retrieved + carton + rental) exactly
  as they already are for the other three.
- `POST /invoices/preview` and `POST /invoices` responses gain
  `BOX_COUNT_AT_BILLING` and `STORAGE_RENTAL_AMOUNT` alongside the
  existing breakdown fields.
- `POST /invoices/:id/reverse` — unchanged shape, but the negated-mirror
  insert now also negates `storage_rental_amount` and copies
  `box_count_at_billing` from the original as-is.
- `PUT /departments/:id` — `price_per_box_stored_monthly` becomes a valid
  field in `updateDepartmentSchema`, validated the same way
  (`z.number().nonnegative().optional()`) as the other three prices.
- `GET /departments` and `GET /companies/:id` — both already strip
  pricing fields from the response for roles without pricing visibility
  (`canSeePricing`/equivalent check); `PRICE_PER_BOX_STORED_MONTHLY` is
  added to that same strip-list in both controllers so it's hidden
  consistently with the other three prices.

## Frontend

- `CompanyDetail.tsx`'s department pricing table/edit-row gains a fourth
  price column, "Price/Storage Rental (monthly)", using the exact same
  inline-edit `input type="number" step="0.01"` pattern already used for
  the other three prices.
- `Invoices.tsx`'s preview breakdown table gains a "Storage Rental" row
  (`box_count_at_billing × price` shown as the quantity/rate pair,
  `storage_rental_amount` as the line amount), inserted alongside the
  existing archived/retrieved/carton rows before the Subtotal row. The
  saved-invoices table doesn't need a new column (it already only shows
  `TOTAL_AMOUNT`, not a line-item breakdown) — the rental amount is
  visible when a saved invoice's breakdown is inspected via preview-style
  detail, if/when that's added; for now the total already includes it.
- `types.ts`: `Department` gets `PRICE_PER_BOX_STORED_MONTHLY: number`;
  `InvoiceBreakdown`/`Invoice` get `BOX_COUNT_AT_BILLING: number` and
  `STORAGE_RENTAL_AMOUNT: number`.

## Testing

- `invoiceCalc.test.ts`: RED/GREEN unit tests for the new term in
  `computeInvoiceAmounts` — a zero rental rate leaves existing behavior
  unchanged (regression guard), a non-zero rate correctly adds into the
  pre-SSCL/VAT subtotal so tax is computed on the combined amount.
- `invoices.test.ts`: extend `POST /preview`, `POST /`, and `POST
  /:id/reverse` tests to assert `BOX_COUNT_AT_BILLING`/
  `STORAGE_RENTAL_AMOUNT` are present and correct, including a reversal
  test asserting `storage_rental_amount` is negated while
  `box_count_at_billing` is copied unchanged from the original.
- `departments.test.ts` / `companies.test.ts`: cover setting
  `price_per_box_stored_monthly` via `PUT /departments/:id`, and that it
  is hidden from roles without pricing visibility — mirroring the
  existing tests for the other three prices exactly.
- Migration: boot `initializeDb()` twice against the real `wh-postgres`
  database, verify via `\d departments` and `\d invoices` that both new
  columns exist with the correct defaults.
- Live E2E: set a non-zero rental rate on a real department, generate an
  invoice, confirm the rental line and total via curl, reverse it,
  confirm the negated mirror in the database directly, and confirm the
  new price field renders and saves correctly in `CompanyDetail.tsx` and
  the rental line renders in `Invoices.tsx`'s preview via a Playwright
  screenshot.

## Out of scope (future/separate work)

- Historical/date-indexed box counts (reconstructing "boxes held as of
  `period_to`" for back-dated invoices) — the live `current_box_count`
  snapshot is used instead, per the Decisions section above.
- Proration of rental by period length — flat monthly charge only.
- A dedicated rate-card entity decoupled from departments — not needed
  for the split-rate scenario the SRS describes, which two department
  rows already handle.
- Retrieval-charge auto-computation (FR-12) and the retrieval-charges
  summary (FR-13) — separate, not-yet-tracked FRs, not addressed here.
