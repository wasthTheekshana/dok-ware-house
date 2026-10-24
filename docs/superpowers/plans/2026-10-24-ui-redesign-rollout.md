# UI Redesign — Rollout (Plan 2 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the design system shipped in Plan 1 (design tokens + shared `components/ui/` library) to the remaining 11 pages of `warehouse-client`, with no functional changes beyond the badge/empty-state/loading-state polish the spec already scoped.

**Architecture:** Plan 1 already proved the pattern on `Layout.tsx`/`Login.tsx`/`Dashboard.tsx`: swap each page's inline-styled `<div>`/`<table>`/`<button>` markup for the shared `PageHeader`/`Card`/`Table`/`Td`/`Tr`/`Badge`/`Button` components, leaving every handler, every API call, and every piece of state untouched. This plan repeats that swap across the rest of the app, one page (or tightly-related pair) per task.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, `lucide-react`, `recharts` (already a dependency, used by `Reports.tsx` — not replaced).

**Spec:** `docs/superpowers/specs/2026-09-22-ui-redesign-design.md` (Section 5, "Rollout to remaining pages")

## Global Constraints

- **Pure restyle + the three specific UX polish items the spec names, nothing else.** No page's data-fetching, validation, permission-gating condition, or API call signature changes. The only behavioral deltas allowed anywhere in this plan: (a) a shared loading state via `Table`'s `loading` prop instead of each page's own `"Loading..."` text, (b) a shared empty state via `Table`'s `empty`/`emptyMessage` props instead of a page rendering a blank `<tbody>`, (c) status values that are today plain text become `Badge` components using the tone mapping below.
- **Badge tone mapping** (exact, from the spec — copy verbatim, do not invent new tones):

  | Page | Field | Tone mapping |
  |---|---|---|
  | `BoxEvents.tsx` | `EVENT_TYPE` | `archived`→`success`, `retrieved`→`info`, `empty_carton_issued`→`neutral`, `disposed`→`danger` |
  | `Payroll.tsx` | `STATUS` | `draft`→`neutral`, `pending_approval`→`warning`, `approved`→`success`, `rejected`→`danger` |
  | `Attendance.tsx` | summary counts (Present/Absent/Half-Day/Leave tiles) | `present`→`success`, `absent`→`danger`, `half_day`→`warning`, `leave`→`info` |
  | `Invoices.tsx` | reversal state | a reversal row (`REVERSES_INVOICE_ID !== null`) → `neutral` badge reading `Reversal of #<id>`; a non-reversal, non-reversed original → no badge |
  | `Companies.tsx`, `Warehouses.tsx`, `CompanyDetail.tsx` (department rows), `Users.tsx` | `STATUS` (`active`/`inactive`) | `active`→`success`, `inactive`→`neutral` |

- **The warehouse-scoping picker pattern is untouchable logic, restyle only.** `Expenses.tsx`, `Staff.tsx`, `Attendance.tsx`, and `Payroll.tsx` each compute `isScoped = user?.ROLE === 'warehouse_admin'`, `selectableWarehouseIds = user?.WAREHOUSE_IDS ?? []`, `selectableWarehouses` filtered by that when `isScoped`, and auto-select the sole warehouse whenever `selectable.length === 1` (unconditional, not gated by `isScoped` — a past regression in this codebase). Every task touching one of these four files must leave this exact logic untouched — only the `<select>` element's wrapping markup may change visually, not its `value`/`onChange`/options-building code.
- **Reused components and their exact props** (shipped in Plan 1, already live on `main`): `PageHeader({title, subtitle?, action?})`, `Card({children, className?, padded?})`, `Table({headers: string[], children, loading?, empty?, emptyMessage?, title?})`, `Td` / `Tr` (styled `<td>`/`<tr>` replacements), `Badge({tone, children})` where `tone` is `'success' | 'info' | 'warning' | 'danger' | 'neutral'`, `Button({variant?, ...ButtonHTMLAttributes})` where `variant` is `'primary' | 'secondary' | 'danger' | 'ghost'` (default `'primary'`), `StatCard({label, value, icon, accent, trend?})` where `accent` is `'brand' | 'sky' | 'green' | 'amber'`. All imported from `../components/ui` (or `./ui` from inside `components/`).
- **No new npm dependencies.**
- **No backend changes anywhere in this plan.**
- **Verification per task**: `cd warehouse-client && npx tsc -b` (zero errors) plus a live Playwright screenshot check against the real dev server/database, following this session's established pattern — this codebase has no frontend unit/component test suite, so the build + live screenshot is the full verification surface, matching Plan 1's precedent exactly.

## Review Focus

1. **A `canX` permission gate that still renders a UI element but the underlying request fires regardless of the gate** — Plan 1's Dashboard review caught exactly this class of bug (a stat card rendering absent but the network request still firing). Every task below touches at least one `canManageX`/`canViewX`-gated page; the live-verification step for each must confirm both the gated element AND its backing request are absent for a role without the permission, not just the element.
2. **Inline-edit row cell-count mismatch** — `Users.tsx`, `BoxEvents.tsx`, `Expenses.tsx`, `Staff.tsx`, `Payroll.tsx` each render a table row two different ways (editing vs. read-only) via a ternary. Swapping `<td>` for `Td` in only one branch, or adding/removing a column in only one branch, breaks column alignment silently (no error, just a visually broken table). Every task touching one of these files must count `Td`s in both ternary branches against the `headers` array length before calling it done.
3. **The warehouse-scoping picker's single-warehouse auto-select regressing** (see Global Constraints) — this codebase has a documented history of this exact regression (two prior bugs this session, both already fixed). Every task touching `Expenses.tsx`/`Staff.tsx`/`Attendance.tsx`/`Payroll.tsx` must live-verify with a `system_admin` test account that has access to exactly one warehouse's worth of data in the relevant list, confirming the picker is still skipped and the single warehouse auto-selected.
4. **Badge tone copy-paste error** — a plausible mistake is swapping which status gets `success` vs. `danger` (e.g. marking `rejected` payroll green). Every task that adds `Badge` usage must be checked against the Global Constraints table value-by-value, not just "a badge renders."
5. **Empty-state regression for a role that legitimately has zero rows** (e.g. a brand-new warehouse_admin with no staff yet) — swapping a bare `{list.length === 0 && ...}` check for `Table`'s `empty` prop must still show something, not a blank table body. No task's live-verification plan below currently forces a zero-row state to appear by default (seed data isn't empty), so each task must explicitly filter/query to produce an empty list for this check (e.g. querying a date range with no data) rather than skipping it because the seeded test data happens to always have rows.

---

### Task 1: Companies + Warehouses

**Files:**
- Modify: `warehouse-client/src/pages/Companies.tsx`
- Modify: `warehouse-client/src/pages/Warehouses.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card`, `Table`, `Td`, `Tr`, `Badge`, `Button` from `../components/ui` (all shipped in Plan 1).
- Produces: no new exports — both remain default exports consumed unchanged by `App.tsx`.

Both pages are simple list + create-form CRUD screens with the same shape: an `<h1>`/button header → a conditionally-shown create `<form>` in a bordered card → a `<table>` in a bordered card. Read each file's current content before editing (94 lines and 105 lines respectively as of this plan).

- [ ] **Step 1: Restyle `Companies.tsx`**
  - Replace the `<h1>...</h1><button>...</button>` header block with `<PageHeader title="Companies" action={<Button onClick={...}>{showForm ? 'Cancel' : 'New Company'}</Button>} />` (keep `showForm`'s toggle logic and the button's existing `onClick` exactly as-is, only the wrapping markup changes).
  - Replace the create-form's `<div className="bg-white rounded-xl border...">` wrapper with `<Card>`; replace its submit `<button>` with `<Button type="submit">Save</Button>`.
  - Replace the table's `<div className="bg-white rounded-xl border...">` wrapper and `<table>`/`<thead>` with `<Table headers={['Name', 'Code', 'Departments', 'Total Boxes']} empty={companies.length === 0}>`; replace each `<tr>`/`<td>` with `<Tr>`/`<Td>` (4 cells per row, matching the 4 headers — Review Focus #2 applies even without an edit-row ternary here, since a miscounted `<Td>` list is the same class of bug).
  - `STATUS` is not currently displayed on this page's table — do not add a column; the Badge mapping for this page only matters if/when a `STATUS` column is added, which it is not here.

- [ ] **Step 2: Restyle `Warehouses.tsx`**
  - Same `PageHeader`/`Card`/`Table`/`Td`/`Tr` swap as Step 1, preserving `canManageWarehouses`'s existing conditional rendering of the "New Warehouse" button exactly as-is (just wrap the existing button in `Button` when `canManageWarehouses` is true).
  - Table headers: `['Name', 'Code', 'Address', 'Departments', 'Status']`, 5 cells per row.
  - The `STATUS` column (`w.STATUS`, currently `<td className="p-3 capitalize">{w.STATUS}</td>`) becomes `<Td><Badge tone={w.STATUS === 'active' ? 'success' : 'neutral'}>{w.STATUS}</Badge></Td>` per the Global Constraints mapping.

- [ ] **Step 3: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Live-verify**

With the dev server running, log in as `admin`, screenshot both `/companies` and `/warehouses`. Confirm: both pages render with the new card/table styling, the Warehouses status badges show the correct tone (active=green, inactive=gray), and (Review Focus #1) log in as a role without `manage_warehouses` and confirm the "New Warehouse" button is absent — it was already permission-gated before this task, confirm the gate still works after the restyle.

- [ ] **Step 5: Commit**

```bash
cd warehouse-client
git add src/pages/Companies.tsx src/pages/Warehouses.tsx
git commit -m "feat(ui): restyle Companies and Warehouses with shared components"
```

---

### Task 2: CompanyDetail

**Files:**
- Modify: `warehouse-client/src/pages/CompanyDetail.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card`, `Table`, `Td`, `Tr`, `Badge`, `Button` from `../components/ui`.
- Produces: no new exports.

This page has an editable department-pricing table (4 price columns: archived/retrieved/empty-carton/storage-rental) with an inline edit-row ternary, plus a create-department form. Read the current file (around 183 lines as of this plan) before editing.

- [ ] **Step 1: Restyle**
  - Header → `PageHeader` with the company name as `title`.
  - Create-department form wrapper → `Card`; its submit button → `Button`.
  - The departments table wrapper → `Table` with headers `['Name', 'Code', 'Warehouse', 'Current Box Count', 'Price/Archived', 'Price/Retrieved', 'Price/Empty Carton', 'Price/Storage Rental (monthly)', 'Actions']` (9 headers — this page's table already has 9 columns per the storage-rental module; recount against the live file, do not assume this list is current if the file has changed).
  - Both the editing-row and read-only-row ternary branches get `Tr`/`Td` swapped in, 9 `Td`s each (Review Focus #2 — the edit row has 4 price `<input>`s plus a Save/Cancel actions cell, the read-only row has 4 plain price values plus an Edit-icon actions cell; count both against the 9 headers).
  - Edit/Save/Cancel icon buttons (`Pencil`/`Check`/`X` from `lucide-react`) stay as icon buttons — do not force them into `Button` component, since `Button` renders text-button styling, not icon-only buttons; leave their existing `className`-based styling as-is except for color tokens that should move from `text-blue-600`/`text-green-600`/etc. to the equivalent semantic color (unchanged — these are already semantic Tailwind colors, not the old `bg-blue-600` brand color, so no change needed here beyond what the ambient `Table`/`Tr`/`Td` restyle already provides).

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify**

Log in as `admin`, navigate to a company's detail page, screenshot the restyled pricing table in both read-only and mid-edit states (click Edit on one row before the second screenshot). Confirm all 9 columns align correctly in both states (Review Focus #2) and pricing edits still save correctly (submit one, confirm the toast and the updated value persist).

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/pages/CompanyDetail.tsx
git commit -m "feat(ui): restyle CompanyDetail with shared components"
```

---

### Task 3: BoxEvents

**Files:**
- Modify: `warehouse-client/src/pages/BoxEvents.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card`, `Table`, `Td`, `Tr`, `Badge`, `Button` from `../components/ui`.
- Produces: no new exports.

Read the current file (252 lines as of this plan) before editing. This page has a log-event form (company→department cascading dropdowns, event type, quantity, date, reference) and an events table with an inline edit-row ternary and a delete action.

- [ ] **Step 1: Restyle**
  - Header → `PageHeader title="Box Events"`.
  - Form wrapper → `Card`; submit button → `Button`.
  - Table wrapper → `Table` with headers `['Date', 'Company', 'Department', 'Type', 'Qty', 'Reference']` plus a conditional `'Actions'` header only when `canManageBoxEvents` (matching the existing conditional `<th className="p-3">Actions</th>` — the `headers` array itself must be built conditionally, e.g. `[...baseHeaders, ...(canManageBoxEvents ? ['Actions'] : [])]`, so the header count still matches the row cell count in both permission states).
  - `EVENT_TYPE` column: replace `<td className="p-3 capitalize">{e.EVENT_TYPE.replace('_', ' ')}</td>` with `<Td><Badge tone={EVENT_BADGE[e.EVENT_TYPE]}>{EVENT_LABEL[e.EVENT_TYPE]}</Badge></Td>` — define `EVENT_BADGE`/`EVENT_LABEL` lookup objects at module scope (same pattern already used in `Dashboard.tsx`, which you can reference for the exact shape) using the Global Constraints tone mapping for this page.
  - Both ternary branches (editing row has a date input + a `<select>` for type + a quantity input + a reference input + Save/Cancel; read-only row has a Badge for type + plain cells + Edit/Delete icons) get `Tr`/`Td`, with the Actions cell only present when `canManageBoxEvents`, in both branches, matching the conditional header.

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify**

Log in as `admin`, screenshot the Box Events table showing at least two different event-type badges with correct colors (e.g. an Archived row green, a Retrieved row blue). Log the quantity-of-rows down to a filter with no matches if possible, or note if the current seed data makes a true zero-row state impractical to reach via the UI alone (Review Focus #5) — if so, verify the `empty` prop logic by temporarily checking it renders correctly via a quick code-level trace (confirm `events.length === 0` is the `empty` prop's value) rather than skipping the check entirely.

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/pages/BoxEvents.tsx
git commit -m "feat(ui): restyle BoxEvents with shared components and status badges"
```

---

### Task 4: Users

**Files:**
- Modify: `warehouse-client/src/pages/Users.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card`, `Table`, `Td`, `Tr`, `Badge`, `Button` from `../components/ui`.
- Produces: no new exports.

Read the current file (304 lines as of this plan) before editing. This is the most structurally complex of the remaining pages: a create-user form, a users table with an inline edit-row ternary (including a per-warehouse checkbox list and a role `<select>`), and a separate permission-overrides radio-grid `<table>` shown below the main table when a row is being edited.

- [ ] **Step 1: Restyle**
  - Header → `PageHeader title="Users" action={...}` (preserve the existing `showCreateForm` toggle button logic).
  - Create-form wrapper → `Card`; submit button → `Button`.
  - Users table wrapper → `Table` with headers `['Username', 'Name', 'Role', 'Warehouses', 'Status', 'Actions']` (6 headers, 6 `Td`s in both ternary branches — the editing branch's warehouse-checkbox-list cell and the read-only branch's joined-warehouse-names cell both count as ONE cell each, matching one header).
  - `STATUS` column (`u.STATUS`, currently `<td className="p-3 capitalize">{u.STATUS}</td>`) becomes a `Badge` per the Global Constraints mapping (`active`→`success`, `inactive`→`neutral`) — note the editing row does NOT currently display status as plain text, it shows a `<select>`, so only the read-only branch's cell changes to a `Badge`.
  - The permission-overrides table (shown conditionally when `editingId !== null`) wraps in `Card` instead of its current `bg-white rounded-xl border` div; its own inner `<table>` can stay a plain `<table>` (not the `Table` component, since it has a non-standard 4-column radio-grid shape with no loading/empty state of its own — using the shared `Table` component here would need `headers`/`loading`/`empty` props that don't fit this table's actual behavior) — just update its `<th>`/`<td>` Tailwind classes to match the new type scale (`text-slate-400`/`font-medium`/`text-xs`/`uppercase`/`tracking-wide` for headers, consistent with how `Table`'s own header styling looks, even though this specific table isn't using the `Table` component).

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify**

Log in as `admin`, screenshot the Users table (status badges visible), then click Edit on one user and screenshot the expanded edit row plus the permission-overrides grid below it. Confirm the edit row's warehouse-checkbox cell and the permission-overrides radio grid both render correctly and remain functional (toggle one override, save, confirm the toast).

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/pages/Users.tsx
git commit -m "feat(ui): restyle Users with shared components and status badges"
```

---

### Task 5: Expenses

**Files:**
- Modify: `warehouse-client/src/pages/Expenses.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card`, `Table`, `Td`, `Tr`, `Badge`, `Button` from `../components/ui`.
- Produces: no new exports.

Read the current file (343 lines as of this plan) before editing. This page has: an entry form (warehouse picker per the Global Constraints scoping pattern, date, 5 category amounts, remarks), a monthly-summary card with a variance table, an optional cross-warehouse comparison card (hidden when `isScoped`), and an entries table with an inline edit-row ternary.

- [ ] **Step 1: Restyle**
  - Header → `PageHeader title="Warehouse Expenses"`.
  - Entry form wrapper → `Card`; submit button → `Button`. The warehouse `<select>` (conditionally shown via `selectableWarehouses.length > 1`) keeps its exact `value`/`onChange` — per Global Constraints, this scoping logic is untouchable.
  - Monthly Summary card and Cross-Warehouse Comparison card wrappers → `Card`; their inner `<table>`s can stay plain `<table>`s (both are small, non-paginated summary tables without their own loading/empty states distinct from the parent page's `loading` — using the full `Table` component here would need an artificial `loading`/`empty` prop that doesn't map to anything real) — just update their header/cell Tailwind classes to match the new type scale, same as Task 4's permission-overrides table.
  - The main entries table wrapper → `Table` with headers `['Date', ...(!isScoped ? ['Warehouse'] : []), 'Transport/Parking', 'Fuel', 'Labour', 'Meals & Refreshments', 'Other', 'Remarks', 'Actions']` — the conditional `Warehouse` header must match the conditional `{!isScoped && <td>...}` cell already in both ternary branches (Review Focus #2: this file already conditionally renders one cell based on `isScoped`, so the header array needs the same condition, not a fixed 9-element array).

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify**

Log in as `admin` (unscoped — sees the Warehouse column and the Comparison card) and screenshot. Then log in as a `warehouse_admin` test account with exactly one warehouse (Review Focus #3) and confirm: the warehouse `<select>` is skipped (single warehouse auto-selected directly into the form), the Warehouse table column is absent, and the Comparison card is absent — screenshot this state too.

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/pages/Expenses.tsx
git commit -m "feat(ui): restyle Expenses with shared components"
```

---

### Task 6: Staff

**Files:**
- Modify: `warehouse-client/src/pages/Staff.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card`, `Table`, `Td`, `Tr`, `Badge`, `Button` from `../components/ui`.
- Produces: no new exports.

Read the current file (243 lines as of this plan) before editing. Same shape as Task 1's pages but with the warehouse-scoping pattern and an inline edit-row ternary.

- [ ] **Step 1: Restyle**
  - Header → `PageHeader title="Staff" action={...}` (preserve `showCreateForm` toggle).
  - Create-form wrapper → `Card`; submit button → `Button`. Warehouse `<select>` scoping logic untouched per Global Constraints.
  - Table wrapper → `Table` with headers `['Name', 'NIC', ...(!isScoped ? ['Warehouse'] : []), 'Designation', 'Join Date', 'Basic Salary', 'EPF No.', 'Status', 'Actions']` — same conditional-Warehouse-column pattern as Task 5.
  - `STATUS` column in the read-only branch (currently `<td className="p-3 capitalize">{s.STATUS}</td>`) becomes a `Badge` (`active`→`success`, `inactive`→`neutral`); the editing branch's status `<select>` stays a `<select>`, unchanged.

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify**

Same two-role check as Task 5 (`admin` unscoped showing the Warehouse column; a single-warehouse `warehouse_admin` with the picker auto-skipped and the column absent — Review Focus #3), plus confirm the status badges render with correct tones. Screenshot both.

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/pages/Staff.tsx
git commit -m "feat(ui): restyle Staff with shared components and status badges"
```

---

### Task 7: Attendance

**Files:**
- Modify: `warehouse-client/src/pages/Attendance.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card`, `StatCard`, `Button` from `../components/ui`.
- Produces: no new exports.

Read the current file (242 lines as of this plan) before editing. This page has a warehouse/date picker + a live staff-attendance-marking grid (not a `Table`-shaped list — each row has a status `<select>` plus conditional time inputs, saved as a batch via one "Save Day" action) and a monthly-summary section with 4 stat tiles (Present/Absent/Half-Day/Leave counts).

- [ ] **Step 1: Restyle**
  - Header → `PageHeader title="Attendance"`.
  - Picker + marking-grid wrapper → `Card`. The marking grid's own `<table>` stays a plain `<table>` (it is not a `Table`-component-shaped read/list view — it is a live-edit form disguised as a table, with no loading/empty state separate from the page's own `loading`), just update its header/cell classes to match the new type scale.
  - "Save Day" button → `Button`.
  - Monthly Summary wrapper → `Card`. The 4 stat tiles (currently `<div className="bg-slate-50 rounded-lg p-3 text-center">`) become 4 `StatCard`s in a grid — `label` = "Present"/"Absent"/"Half-Day"/"Leave", `value` = the corresponding `summary.counts.*` as a string, `accent` = per the Global Constraints mapping (`present`→treat as `'green'` StatCard accent since StatCard's accent enum is `'brand'|'sky'|'green'|'amber'`, not the Badge tone enum — there is no StatCard danger/red accent shipped in Plan 1, so for `absent` use `accent="amber"` as the closest available warning-adjacent accent rather than inventing a new StatCard variant not in Plan 1's shipped set; `half_day`→`'sky'`, `leave`→`'brand'`). State this substitution explicitly in the commit message since it's a deliberate deviation from a literal Badge-tone-to-StatCard-accent mapping (the two components have different, non-overlapping accent vocabularies).

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify**

Log in as `admin`, select a warehouse/date with staff present, screenshot the marking grid. Then load a month with summary data for one staff member and screenshot the 4 `StatCard` tiles. Confirm saving a day's attendance still works (change one status, Save Day, confirm toast). Also repeat the single-warehouse auto-select check from Task 5/6 (Review Focus #3) with a scoped test account.

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/pages/Attendance.tsx
git commit -m "feat(ui): restyle Attendance with shared components and stat tiles"
```

---

### Task 8: Payroll

**Files:**
- Modify: `warehouse-client/src/pages/Payroll.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card`, `Table`, `Td`, `Tr`, `Badge`, `Button` from `../components/ui`.
- Produces: no new exports.

Read the current file (326 lines as of this plan) before editing. The most complex remaining page: a "Prepare Payroll" form (warehouse/staff/month/year), an 11-column records table with an inline edit-row ternary AND role/status-conditional action buttons (Edit/Submit, Approve/Reject, Reverse — each shown only for specific `STATUS` + role combinations), and a Consolidated Payroll Report card visible only to approvers.

- [ ] **Step 1: Restyle**
  - Header → `PageHeader title="Payroll"`.
  - "Prepare Payroll" card wrapper → `Card` (already conditionally rendered via `canPrepareStaffList` — keep that condition exactly as-is). Its "Create Draft" button → `Button`. Warehouse/staff/month/year selects untouched (scoping logic untouchable per Global Constraints).
  - Records table wrapper → `Table` with the same 11 headers already present (`['Staff', 'Period', 'Basic', 'OT', 'Deductions', 'EPF (Emp.)', 'EPF (Emplr.)', 'ETF', 'Net Salary', 'Status', 'Actions']`).
  - `STATUS` column: the read-only branch currently uses an inline `<span className={p.STATUS === 'approved' ? 'text-green-600' : ...}>{STATUS_LABELS[p.STATUS]}</span>` — replace with `<Badge tone={PAYROLL_BADGE[p.STATUS]}>{STATUS_LABELS[p.STATUS]}</Badge>` using a `PAYROLL_BADGE` lookup object (module scope, same pattern as Task 3's `EVENT_BADGE`) built from the Global Constraints mapping. The editing branch still shows plain text (`{STATUS_LABELS[p.STATUS]}`, no edit control for status) — leave that cell as plain text inside a `Td`, not a `Badge` (status isn't editable here, only shown).
  - Action buttons (Edit/Submit/Approve/Reject/Reverse) keep their exact `onClick`/conditional-rendering logic (the `STATUS === 'draft' || STATUS === 'rejected'` etc. checks) — only convert their wrapping markup to use `Button variant="secondary"` (Edit), `Button variant="primary"` (Submit), `Button variant="primary"` (Approve), `Button variant="danger"` (Reject), `Button variant="secondary"` (Reverse), sized down if needed via `className="text-xs px-2 py-1"` passthrough (Button accepts a `className` override per its Plan 1 signature) to fit multiple buttons in one cell as the current layout does.
  - Consolidated Payroll Report card wrapper → `Card` (conditionally rendered via `isApprover`, unchanged). Its inner `<table>` can stay plain (same reasoning as Task 4/5's small summary tables), with updated header/cell classes.

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify**

Log in as `admin` (isApprover), screenshot the records table showing at least two different status badges (e.g. a draft row gray, an approved row green) and the Consolidated Report card. Confirm the action-button visibility rules still work exactly as before: a `draft` row shows Edit+Submit, an `approved` row shows Reverse (and no Edit/Submit), a `pending_approval` row shows Approve+Reject — this is Review Focus #4 territory (a swapped Badge tone would be visually wrong but functionally silent; the action-button conditions are separate code paths that must also be checked, not just the Badge).

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/pages/Payroll.tsx
git commit -m "feat(ui): restyle Payroll with shared components and status badges"
```

---

### Task 9: Invoices

**Files:**
- Modify: `warehouse-client/src/pages/Invoices.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card`, `Table`, `Td`, `Tr`, `Badge`, `Button` from `../components/ui`.
- Produces: no new exports.

Read the current file (its exact current line count has drifted from earlier reads in this session due to the storage-rental and immutability modules — re-read in full before editing) before editing. This page has a preview form (company→department cascade, period dates, Preview button), a preview-breakdown card (archived/retrieved/empty-carton/storage-rental/subtotal/SSCL/VAT/total rows, a Save Invoice button), and a saved-invoices table with a Reverse action (hidden for already-reversed/reversal rows per the immutability module shipped earlier this session).

- [ ] **Step 1: Restyle**
  - Header → `PageHeader title="Invoices"`.
  - Preview form wrapper → `Card`; Preview button → `Button`.
  - Preview breakdown wrapper → `Card`; its internal rows can stay a plain two-column layout (it is a receipt-style line-item display, not a `Table`-shaped list — do not force it into the `Table` component); Save Invoice button → `Button variant="primary"` (currently `bg-green-600`, a distinct accent color from the rest of the app — Plan 1's `Button` component has no separate "success" variant, so use `variant="primary"` here, accepting the color changes from green to indigo; this is an intentional, spec-consistent simplification to the unified button vocabulary, not an oversight — state this in the commit message).
  - Saved-invoices table wrapper → `Table` with headers `['Period', 'Company', 'Department', 'Total', 'Saved', 'Actions']` (6 headers, 6 `Td`s per row — this table has no edit-row ternary, just one row shape per invoice).
  - The reversal-state Actions cell (currently a conditional `Reverse` button OR a "Reversal of #N" text span) becomes: `Reverse` → `Button variant="danger" className="text-xs px-2 py-1"` (kept conditional on `canManageInvoices && inv.REVERSES_INVOICE_ID === null && !reversedOriginalIds.has(inv.ID)`, exactly as today); "Reversal of #N" → `<Badge tone="neutral">Reversal of #{inv.REVERSES_INVOICE_ID}</Badge>` per the Global Constraints mapping.

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify**

Log in as `admin`, run a preview for a department/period with box activity, screenshot the breakdown card. Save it, screenshot the saved-invoices table showing the new row. Reverse it, screenshot the table again showing the reversal row's "Reversal of #N" badge and the original row's Reverse button now absent (this exercises the exact reversal/immutability logic shipped earlier this session — confirm it still works unchanged after the restyle). Clean up the test invoice/reversal pair from the database afterward, matching this session's established pattern for live financial-flow verification.

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/pages/Invoices.tsx
git commit -m "feat(ui): restyle Invoices with shared components and reversal badges"
```

---

### Task 10: Reports

**Files:**
- Modify: `warehouse-client/src/pages/Reports.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `Card` from `../components/ui`.
- Produces: no new exports.

Read the current file (67 lines as of this plan) before editing. The simplest remaining page: a `recharts` `BarChart` in a card, and a company-summary `<table>` in a card. No edit-row ternary, no permission gating beyond the page being nav-gated already.

- [ ] **Step 1: Restyle**
  - Header → `PageHeader title="Reports"`.
  - Both card wrappers (`bg-white rounded-xl border...`) → `Card`. The `recharts` `<BarChart>`/`<ResponsiveContainer>` itself is NOT touched — it is a third-party charting library already in use, out of scope for this plan's "no new npm dependencies, restyle only" boundary (restyling its bar colors is also out of scope — the spec doesn't ask for it and it isn't one of the three named UX-polish items).
  - The company-summary table can use the `Table` component (headers `['Company', 'Total Boxes']`, 2 `Td`s per row) since it's a simple list with no edit states, matching the pattern used everywhere else in this plan.

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify**

Log in as `admin`, screenshot `/reports` confirming both cards render in the new style and the chart itself still displays correctly (unchanged visually from before, just inside a restyled card).

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/pages/Reports.tsx
git commit -m "feat(ui): restyle Reports with shared components"
```

---

### Task 11: Final verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-10 (and, transitively, Plan 1's foundation).

- [ ] **Step 1: Full frontend build**

Run: `cd warehouse-client && npx tsc -b`
Expected: zero errors.

- [ ] **Step 2: Confirm the backend test suite is untouched and still green**

Run: `cd warehouse-server && npx jest`
Expected: PASS, same count as before this plan (191/191 as of Plan 1's completion) — this plan makes no backend changes, so this is a pure regression check.

- [ ] **Step 3: Full live walkthrough with screenshots, logged in as both `admin` (system_admin) and a scoped `warehouse_admin` test account**

For each of the 11 restyled pages (Companies, Warehouses, CompanyDetail, BoxEvents, Users, Expenses, Staff, Attendance, Payroll, Invoices, Reports), navigate to it and confirm it renders with the shared design system (indigo accent, Inter font, soft-shadow `rounded-card` cards, consistent `Badge`/`Button`/`Table` usage) with no leftover `bg-blue-*`/`rounded-xl border-slate-200`-style old markup anywhere. Screenshot at least the pages each role can see. Read every screenshot back before reporting success.

- [ ] **Step 4: Targeted Review Focus checks**

Re-confirm, live, each of the 5 Review Focus items from this plan's header: (1) a permission-gated element's backing request is genuinely absent, not just the element, on at least one page per role; (2) no inline-edit table has a cell-count mismatch between its two ternary branches (grep the diff for `<Td>` counts per `Tr` if a visual screenshot doesn't make an edit-row's alignment obvious enough); (3) the warehouse-scoping single-warehouse auto-select still works on at least one of Expenses/Staff/Attendance/Payroll; (4) spot-check at least 3 Badge usages across different pages against the Global Constraints tone table; (5) confirm at least one genuinely-empty-list state renders the `Table` component's `empty`/`emptyMessage` correctly rather than a blank table.

- [ ] **Step 5: Report**

Summarize: build status, backend regression check, confirmation all 11 pages were visually reviewed and match the design system, and confirmation of each Review Focus item. No commit needed for this task unless a bug fix was required during verification (in which case commit that fix in its own commit).
