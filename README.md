# DOK Warehouse

Standalone warehouse management system for DOK Solutions Lanka — tracks
customers/departments and their box lifecycle (archived / retrieved /
empty-carton-issued), replacing manual Excel tracking.

## Stack

- **Backend** (`warehouse-server/`): Node.js, Express 5, TypeScript, PostgreSQL (`pg`), JWT auth, Jest
- **Frontend** (`warehouse-client/`): React 19, Vite, TypeScript, TailwindCSS v4, Recharts

## Setup

### 1. Database

Requires a PostgreSQL instance. Example via Docker:

```bash
docker run -d --name wh-postgres \
  -e POSTGRES_USER=dokwarehouse -e POSTGRES_PASSWORD=changeme -e POSTGRES_DB=dok_warehouse \
  -p 5433:5432 postgres:16-alpine
```

### 2. Backend

```bash
cd warehouse-server
cp .env.example .env   # edit WH_DB_* / JWT_SECRET as needed
npm install
npm run seed            # creates schema + admin/password123
npm run dev              # http://localhost:5100
```

> **Note:** This app has no migration runner — schema is applied every time the
> server boots (`initializeDb()` in `src/db/config.ts`). New tables use
> `CREATE TABLE IF NOT EXISTS`, which is safe on both fresh and existing
> databases. Adding a column to an *existing* table needs its own
> `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` alongside the `CREATE TABLE` text
> (the Invoicing module's department pricing columns are the current example) —
> both are idempotent, so simply restarting the server (`npm run dev`) against
> an older database picks up new tables and new columns automatically. No
> `DROP`/reseed needed for schema changes going forward.

### 3. Frontend

```bash
cd warehouse-client
npm install
npm run dev              # http://localhost:5175
```

## Default login

`admin` / `password123` (created by `npm run seed`).

## Docs

- `docs/superpowers/specs/2026-08-24-warehouse-customer-box-inventory-design.md` — Module 1: Customers & Box Inventory
- `docs/superpowers/specs/2026-09-01-warehouses-design.md` — Module 2: Warehouses (physical locations)
- `docs/superpowers/specs/2026-09-02-user-management-design.md` — Module 3: User Management
- `docs/superpowers/specs/2026-09-02-invoicing-design.md` — Module 4: Invoicing
- `docs/superpowers/plans/` — matching implementation plan for each module above

## Roadmap

Complete: Module 1 (Customers & Box Inventory, including event
edit/delete/history), Module 2 (Warehouses), Module 3 (User Management,
including the last-active-admin guard and self-service password change),
Module 4 (Invoicing — flat per-department pricing, preview/save,
SSCL + VAT). Planned next: warehouse daily expense report (tracked per
physical warehouse location, not per customer — see the source Excel
workbook this app is replacing).
