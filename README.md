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

### 3. Frontend

```bash
cd warehouse-client
npm install
npm run dev              # http://localhost:5175
```

## Docs

- `docs/superpowers/specs/2026-08-24-warehouse-customer-box-inventory-design.md` — Module 1: Customers & Box Inventory
- `docs/superpowers/specs/2026-09-01-warehouses-design.md` — Module 2: Warehouses (physical locations)
- `docs/superpowers/plans/2026-08-24-warehouse-customer-box-inventory.md` — Module 1 implementation plan

## Roadmap

Module 1 (Customers & Box Inventory) is complete, including event
edit/delete/history. Module 2 (Warehouses) is in design. Planned next:
user management, invoicing/billing, warehouse daily expense report.
