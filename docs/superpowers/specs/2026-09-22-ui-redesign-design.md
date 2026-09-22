# DOK Warehouse System — UI Redesign ("Modern & Beautiful")

## Context

The `warehouse-client` frontend has shipped module-by-module since this
project began, and every page uses the same plain, ad hoc Tailwind styling:
white cards on a slate-50 background, blue-600 buttons, no defined type
scale, no component reuse — each page repeats its own inline `className`
strings for cards, tables, and buttons. It works, but reads as a generic,
unstyled admin panel rather than a polished product.

The user asked for a full visual redesign: "fully change the design,
dashboard all the ui want to modern and beautiful." This spec covers a
**pure visual and light-UX redesign** across all ~12 pages plus the shared
layout shell — no backend changes, no changes to business logic,
permissions, or data flows, except the Dashboard gaining three new
read-only widgets sourced entirely from endpoints that already exist.

Design direction was chosen collaboratively via the visual-companion
browser tool (mockups compared side by side, not described in prose):

- **Overall style**: Clean Modern SaaS — light background, white cards,
  soft shadows, generous rounding. (Rejected: warm/teal, bold dark,
  minimal monochrome.)
- **Accent color**: Indigo (`#4f46e5`). (Rejected: classic blue, violet,
  emerald.)
- **Density**: Balanced & Soft — medium spacing, ~12px radius, soft drop
  shadow instead of hard borders. (Rejected: compact/sharp,
  spacious/airy.)
- **Typography**: Inter. (Rejected: system-ui, Plus Jakarta Sans.)
- **Dashboard stat cards**: each gets its own accent color (not
  uniformly indigo) — validated via a second mockup iteration after the
  user asked for this explicitly.

## Decisions

- **Pure restyle + minor UX polish, not a functional rewrite.** Every
  page's data-fetching, validation, and permission-gating logic is
  untouched. "Minor UX polish" is scoped narrowly to: consistent
  loading states (a shared skeleton/spinner instead of each page's own
  "Loading..." text), consistent empty states ("No records yet"
  instead of a blank table), and status values that are currently plain
  text becoming color-coded `Badge` components. Nothing else changes
  behaviorally — this keeps the existing 191 backend tests as the
  correctness net and means no backend code is touched by this work at
  all.
- **Tailwind v4 theme tokens, no new styling dependency.** The app has
  no `tailwind.config.js` (Tailwind v4 is config-less/CSS-native); today
  `warehouse-client/src/index.css` is just `@import "tailwindcss";`. The
  new palette, radius, and font are defined there via Tailwind v4's
  `@theme` directive plus a Google Fonts `@import` for Inter. No
  component library, no CSS-in-JS, no new npm package.
- **A small shared component layer, not per-page styling.** Six
  presentational components live in a new `warehouse-client/src/components/ui/`
  directory: `Card`, `StatCard`, `Badge`, `Table` (with `Th`/`Td`
  sub-parts), `Button` (variants: primary/secondary/danger/ghost), and
  `PageHeader`. These are pure wrappers — they accept the same data/props
  the pages already have and render it with the new visual language.
  Every existing page swaps its inline-styled markup for these
  components; no page grows new state or new data dependencies from
  this change.
- **Responsive sidebar**, closing a real, pre-existing SRS gap. NFR-5
  requires warehouse staff be able to use this on tablets; the current
  `Layout.tsx` sidebar is a fixed 256px column with no responsive
  behavior at all. The redesigned shell adds a breakpoint at 1024px:
  above it, the fixed sidebar as mocked; below it, the sidebar becomes an
  off-canvas drawer toggled by a hamburger button in a new slim top bar.
  This is new layout behavior, not new business logic — no permission or
  data-flow change.
- **Login gets a full two-panel redesign** (branded indigo-gradient left
  panel, form on the right), not just a restyle, since it's explicitly
  the first impression of the new look. The gradient is pure CSS (a
  `linear-gradient` plus the existing wordmark) — no external image
  assets to source or license. Submit handling, validation, and error
  toasts are unchanged.
- **Dashboard gains three new widgets**, all sourced from existing
  endpoints, none requiring a backend change:
  - **Revenue This Month** — sums `GET /invoices`' `TOTAL_AMOUNT` for
    rows whose `CREATED_AT` falls in the current calendar month,
    computed client-side from the already-unfiltered invoice list. Only
    rendered when the viewer holds `view_invoices` (same gating
    convention already used throughout the app); hidden otherwise, not
    shown-with-zero.
  - **Boxes by Warehouse** — groups `GET /departments`'
    `CURRENT_BOX_COUNT` by `WAREHOUSE_NAME` client-side. A
    `warehouse_admin` naturally sees only their own scope (single bar)
    since `GET /departments` already scopes its results server-side —
    no new scoping logic needed here.
  - **Box Movement — Last 6 Months** — a pure-CSS bar chart (styled
    `div`s, no charting library) summing `archived + retrieved` per
    month from `GET /summary/monthly`.
  - The existing "Total Boxes in Storage," "Active Companies," and
    "Recent Box Events" widgets are kept, restyled as `StatCard`s and a
    `Table` respectively, with "Recent Events" reframed as "Events This
    Week" (count of `box_events` in the last 7 days, same underlying
    `GET /box-events` call already made, filtered client-side by date
    instead of just taking the first 10 rows — a genuine minor
    improvement, since "Recent Events: 10" today is really just "however
    many rows we happened to fetch," not a meaningful count).
- **Icon set stays `lucide-react`** (already a dependency, already used
  throughout `Layout.tsx` and several pages) — no new icon library.

## Design tokens (Tailwind v4 `@theme`, in `index.css`)

```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;

  --color-brand-50: #eef2ff;
  --color-brand-100: #e0e7ff;
  --color-brand-200: #c7d2fe;
  --color-brand-400: #818cf8;
  --color-brand-500: #6366f1;
  --color-brand-600: #4f46e5;
  --color-brand-700: #4338ca;

  --radius-card: 0.875rem; /* ~14px, the "balanced & soft" radius */
}
```

`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');`
is added above the `@import "tailwindcss"` line (Google Fonts, matching
what the mockups loaded).

Status colors (for `Badge`) are existing Tailwind palette colors used
consistently, not new tokens: `emerald` (success / archived / approved),
`sky` (info / retrieved), `amber` (warning / pending), `red` (danger /
disposed / rejected) — matching the color coding already validated in the
Dashboard mockup's event-type pills.

## Shared components (`warehouse-client/src/components/ui/`)

- **`Card.tsx`** — `<div className="bg-white rounded-card shadow-soft p-4">`
  wrapper (a `shadow-soft` utility is defined alongside the theme tokens
  for the mockup's exact shadow recipe: `0 1px 3px rgba(0,0,0,0.08)`).
  Replaces every page's repeated `"bg-white rounded-xl border border-slate-200 p-4"`.
- **`StatCard.tsx`** — props: `label`, `value`, `icon` (a `lucide-react`
  component), `accentColor` (one of a small fixed set: `'brand' |
  'sky' | 'green' | 'amber'`), optional `trend` (string, e.g. "↑ 12.4%
  vs last month"). Renders the colored-icon-chip + big value + trend
  line pattern from the approved Dashboard mockup. The `'brand'` variant
  renders the filled-gradient card style (used for exactly one "hero"
  stat per page, matching the Dashboard's "Total Boxes" treatment); the
  other three render the white-card-with-left-accent-border style.
- **`Badge.tsx`** — props: `tone` (`'success' | 'info' | 'warning' |
  'danger' | 'neutral'`), `children`. Renders the pill shape from the
  mockup.
- **`Table.tsx`** — a thin wrapper providing the card-wrapped table
  shell, header row styling, and a built-in empty state (`emptyMessage`
  prop, defaults to `"No records yet"`) and loading state (`loading`
  prop, renders a skeleton). `Th`/`Td` are typed re-exports of plain
  `<th>`/`<td>` with the shared cell padding/typography classes, so
  existing `<table>`/`<tbody>`/`<tr>` markup in each page barely
  changes shape — only the cell tags and the outer wrapper change.
- **`Button.tsx`** — props: `variant` (`'primary' | 'secondary' |
  'danger' | 'ghost'`), otherwise a passthrough `<button>` (all existing
  `onClick`/`disabled`/`type` props work unchanged).
- **`PageHeader.tsx`** — props: `title`, optional `subtitle`, optional
  `action` (a node, typically a `Button`). Replaces each page's ad hoc
  `<h1 className="text-2xl font-bold text-slate-800">Companies</h1>`.

## Layout shell (`Layout.tsx`)

- Desktop (≥1024px, Tailwind `lg:`): unchanged structural shape from
  today (fixed sidebar + main content), restyled with the new logo mark
  (a small gradient square + "DOK Warehouse" in Inter 800), indigo
  active-nav-item pill, and a divider before the user-name/change-password/logout
  section — matching the approved Dashboard mockup's sidebar exactly.
- Below 1024px: the sidebar becomes a fixed-position off-canvas drawer
  (`translate-x-[-100%]` when closed, `translate-x-0` when open,
  CSS-transitioned), triggered by a hamburger `Menu` icon
  (`lucide-react`) in a new slim top bar that only renders at this
  breakpoint. A semi-transparent backdrop closes the drawer on tap,
  matching standard mobile-nav conventions.
- The change-password modal keeps its exact current fields and submit
  logic; only its container becomes a `Card`-styled dialog and its
  inputs/buttons become the shared `Button`/input styling.

## Login page (`Login.tsx`)

Two-panel layout, full viewport height:

- **Left panel** (hidden below `md:`, so mobile falls back to a single
  centered form — matching the tablet-usability requirement rather than
  fighting it): `background: linear-gradient(135deg, #4f46e5, #6366f1)`,
  the DOK Warehouse wordmark, and a short static tagline ("Document
  archiving & warehouse management, simplified.").
- **Right panel**: the existing username/password form, restyled with
  the shared `Button` and new input classes. `handleSubmit`, `loading`
  state, and error toast are byte-for-byte unchanged from the current
  implementation.

## Dashboard (`Dashboard.tsx`)

Per the Decisions section above. Concretely, the page fetches (in
parallel, as it does today): `GET /summary/companies`, `GET
/box-events`, `GET /departments`, `GET /summary/monthly` (a new call —
existing endpoint, not called by this page today), and conditionally
`GET /invoices` when `view_invoices` is held. Renders: `PageHeader`
greeting, a 4-`StatCard` grid (Total Boxes [brand/hero], Active
Companies [sky], Revenue This Month [green, permission-gated], Events
This Week [amber]), a two-column row (pure-CSS 6-month bar chart +
Boxes-by-Warehouse bar list), and a `Table` of the 10 most recent box
events with `Badge`-rendered event types.

## Rollout to remaining pages

Companies, CompanyDetail, Warehouses, BoxEvents, Reports, Expenses,
Staff, Attendance, Payroll, Users, Invoices: each page's existing markup
is restructured to use `PageHeader`/`Card`/`Table`/`Badge`/`Button` in
place of its current inline-styled `div`/`table`/`button` markup, with
the following status→`Badge` mappings (the concrete instance of "status
values become color-coded badges" from the Decisions section):

| Page | Field | Badge tones |
|---|---|---|
| BoxEvents | `EVENT_TYPE` | archived→success, retrieved→info, empty_carton_issued→neutral, disposed→danger |
| Payroll | `STATUS` | draft→neutral, pending_approval→warning, approved→success, rejected→danger |
| Attendance | `STATUS` | present→success, absent→danger, half_day→warning, leave→info |
| Invoices | reversal state | a non-reversal, non-reversed original→no badge; a reversal row→neutral "Reversal of #N" (existing text, now badge-styled) |
| Companies/Warehouses/Departments | `STATUS` (`active`/`inactive`) | active→success, inactive→neutral |
| Users | `STATUS` (`active`/`inactive`) | same as above |

No page's field list, validation, permission check, or API call changes
— only the JSX structure and class names change to route through the
shared components.

## Testing

- Backend: untouched. The existing 191 tests remain the full regression
  net; no new backend tests are needed since no backend code changes.
- Frontend: `npx tsc -b` must stay clean after every page's rework (this
  codebase has no frontend unit/component test suite today — introducing
  one is out of scope for this redesign).
- Live verification: per this session's established pattern, each
  reworked page is checked live (dev server + Playwright screenshots)
  after its own task, logged in as both `system_admin` (unscoped) and a
  scoped `warehouse_admin` test account, confirming: the new components
  render with real data, permission-gated elements (pricing columns,
  Revenue stat, admin-only nav items) still correctly hide/show, and —
  specifically for the Layout task — the responsive drawer actually
  opens/closes and the desktop/mobile breakpoint switch happens at the
  right width.

## Out of scope (future/separate work)

- Dark mode — not requested; the whole system above assumes light mode
  only.
- A frontend component test suite (Vitest/RTL) — this redesign doesn't
  introduce one; it's a pre-existing gap, not created by this work.
- Any backend change, including new endpoints, new query parameters, or
  new fields — every widget above is built from data already returned by
  existing endpoints.
- Barcode UI, DOK-HR integration UI, PDF/Excel export UI (Phase 3 FRs) —
  those are separate, not-yet-built features; this redesign only
  restyles what already exists.
