# UI Redesign — Foundation (Plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the new visual design system (colors, typography, spacing/shadow tokens, a shared component layer) and apply it to the three pages already validated via mockups — the layout shell, Login, and Dashboard (with three new data-driven widgets) — leaving the remaining ~11 pages for a follow-up plan (Plan 2) once these components are proven live.

**Architecture:** Tailwind v4 theme tokens defined once in `index.css`; a small set of presentational React components in `warehouse-client/src/components/ui/` that encode the new visual language; three consuming rewrites (`Layout.tsx`, `Login.tsx`, `Dashboard.tsx`) that use those components. No backend changes. No new npm dependencies.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4 (config-less, `@theme` in CSS), Vite, `lucide-react` (already a dependency), Google Fonts (Inter, loaded via `@import`).

**Spec:** `docs/superpowers/specs/2026-09-22-ui-redesign-design.md`

## Global Constraints

- **Pure restyle + minor UX polish only.** No page's data-fetching, validation, or permission-gating logic changes, except Dashboard gaining three new read-only widgets sourced from endpoints that already exist (`GET /departments`, `GET /summary/monthly`, `GET /invoices`).
- **Design tokens** (exact values, from the approved mockups): accent color `#4f46e5` (indigo), font Inter, card radius ~14px (`0.875rem`), shadow `0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)`.
- **No new npm dependencies.** The Dashboard's chart is pure CSS (styled `div`s), not a charting library.
- **Responsive breakpoint**: sidebar is fixed at `≥1024px` (Tailwind `lg:`), an off-canvas drawer below it — this satisfies SRS NFR-5 (tablet usability), which the current layout does not meet.
- **Permission gating stays exactly as it is today** — e.g. the Revenue stat card only renders when `view_invoices` is held, same convention already used throughout this app.

---

### Task 1: Design tokens (`index.css`)

**Files:**
- Modify: `warehouse-client/src/index.css`

**Interfaces:**
- Produces: Tailwind utilities `bg-brand-{50,100,200,400,500,600,700}`, `text-brand-*`, `border-brand-*` (from the `--color-brand-*` theme vars), the `font-sans` default becoming Inter, a `rounded-card` utility (from `--radius-card`), and a `.shadow-soft` utility class. Every later task (2-5) uses `bg-brand-600`, `rounded-card`, and `shadow-soft`.

The current file is:

```css
@import "tailwindcss";
```

- [ ] **Step 1: Replace the file**

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
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

  --radius-card: 0.875rem;
}

.shadow-soft {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
}
```

- [ ] **Step 2: Verify the tokens compile into real CSS**

Run: `cd warehouse-client && npx vite build`
Expected: build succeeds (exit 0). Then run:
`grep -o "bg-brand-600\|#4f46e5\|Inter" dist/assets/*.css | sort -u`
Expected output includes at least one match for `#4f46e5` (confirms the theme color compiled) — Tailwind v4 only emits a utility class into the CSS if something in the source uses it, so `bg-brand-600` itself won't appear yet (nothing uses it until Task 3+), but the raw `--color-brand-600: #4f46e5` custom-property declaration will be present in the compiled CSS's `:root`/`@theme` output. Grep for `#4f46e5` specifically to confirm.

- [ ] **Step 3: Commit**

```bash
cd warehouse-client
git add src/index.css
git commit -m "feat(ui): add design tokens (indigo palette, Inter, card radius/shadow)"
```

---

### Task 2: Shared UI components

**Files:**
- Create: `warehouse-client/src/components/ui/Card.tsx`
- Create: `warehouse-client/src/components/ui/Badge.tsx`
- Create: `warehouse-client/src/components/ui/Button.tsx`
- Create: `warehouse-client/src/components/ui/PageHeader.tsx`
- Create: `warehouse-client/src/components/ui/StatCard.tsx`
- Create: `warehouse-client/src/components/ui/Table.tsx`
- Create: `warehouse-client/src/components/ui/index.ts`

**Interfaces:**
- Consumes: `rounded-card`, `shadow-soft`, `bg-brand-*` from Task 1.
- Produces (exact exports, used verbatim by Tasks 3-5):
  - `Card`: `React.FC<{ children: React.ReactNode; className?: string; padded?: boolean }>`
  - `Badge`: `React.FC<{ tone: BadgeTone; children: React.ReactNode }>`, `type BadgeTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'`
  - `Button`: `React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }>`, `type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'` (defaults to `'primary'`)
  - `PageHeader`: `React.FC<{ title: string; subtitle?: string; action?: React.ReactNode }>`
  - `StatCard`: `React.FC<{ label: string; value: string; icon: LucideIcon; accent: StatCardAccent; trend?: string }>`, `type StatCardAccent = 'brand' | 'sky' | 'green' | 'amber'`
  - `Table` (default export): `React.FC<{ headers: string[]; children: React.ReactNode; loading?: boolean; empty?: boolean; emptyMessage?: string; title?: string }>`
  - `Td`: `React.FC<React.TdHTMLAttributes<HTMLTableCellElement>>`
  - `Tr`: `React.FC<React.HTMLAttributes<HTMLTableRowElement>>`
  - All re-exported from `warehouse-client/src/components/ui/index.ts`.

This codebase has no frontend unit/component test suite (confirmed in the spec's Testing section), so this task's verification is a clean TypeScript build, not automated tests — the real behavioral proof comes from Task 5 (Dashboard), the first page to use every one of these components live.

- [ ] **Step 1: Create `Card.tsx`**

```tsx
import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    padded?: boolean;
}

const Card: React.FC<CardProps> = ({ children, className = '', padded = true }) => (
    <div className={`bg-white rounded-card shadow-soft ${padded ? 'p-4' : ''} ${className}`}>
        {children}
    </div>
);

export default Card;
```

- [ ] **Step 2: Create `Badge.tsx`**

```tsx
import React from 'react';

export type BadgeTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const TONE_CLASSES: Record<BadgeTone, string> = {
    success: 'bg-emerald-50 text-emerald-700',
    info: 'bg-sky-50 text-sky-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-red-50 text-red-700',
    neutral: 'bg-slate-100 text-slate-600',
};

interface BadgeProps {
    tone: BadgeTone;
    children: React.ReactNode;
}

const Badge: React.FC<BadgeProps> = ({ tone, children }) => (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${TONE_CLASSES[tone]}`}>
        {children}
    </span>
);

export default Badge;
```

- [ ] **Step 3: Create `Button.tsx`**

```tsx
import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-slate-600 hover:bg-slate-100',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
}

const Button: React.FC<ButtonProps> = ({ variant = 'primary', className = '', ...rest }) => (
    <button
        className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors ${VARIANT_CLASSES[variant]} ${className}`}
        {...rest}
    />
);

export default Button;
```

- [ ] **Step 4: Create `PageHeader.tsx`**

```tsx
import React from 'react';

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, action }) => (
    <div className="flex items-center justify-between">
        <div>
            <h1 className="text-xl font-bold text-slate-800">{title}</h1>
            {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
    </div>
);

export default PageHeader;
```

- [ ] **Step 5: Create `StatCard.tsx`**

```tsx
import React from 'react';
import type { LucideIcon } from 'lucide-react';

export type StatCardAccent = 'brand' | 'sky' | 'green' | 'amber';

const ACCENT_STYLES: Record<Exclude<StatCardAccent, 'brand'>, { border: string; iconBg: string; trend: string }> = {
    sky: { border: 'border-l-4 border-sky-500', iconBg: 'bg-sky-100', trend: 'text-sky-600' },
    green: { border: 'border-l-4 border-emerald-600', iconBg: 'bg-emerald-100', trend: 'text-emerald-600' },
    amber: { border: 'border-l-4 border-amber-500', iconBg: 'bg-amber-100', trend: 'text-amber-600' },
};

interface StatCardProps {
    label: string;
    value: string;
    icon: LucideIcon;
    accent: StatCardAccent;
    trend?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon: Icon, accent, trend }) => {
    if (accent === 'brand') {
        return (
            <div className="rounded-card shadow-soft p-4 text-white bg-gradient-to-br from-brand-600 to-brand-500">
                <div className="flex items-start justify-between">
                    <div className="text-xs font-semibold opacity-85 uppercase tracking-wide">{label}</div>
                    <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                        <Icon size={16} />
                    </div>
                </div>
                <div className="text-2xl font-extrabold mt-2">{value}</div>
                {trend && <div className="text-xs opacity-90 font-semibold mt-1">{trend}</div>}
            </div>
        );
    }

    const styles = ACCENT_STYLES[accent];
    return (
        <div className={`bg-white rounded-card shadow-soft p-4 ${styles.border}`}>
            <div className="flex items-start justify-between">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
                <div className={`w-8 h-8 rounded-lg ${styles.iconBg} flex items-center justify-center`}>
                    <Icon size={16} />
                </div>
            </div>
            <div className="text-2xl font-extrabold text-slate-800 mt-2">{value}</div>
            {trend && <div className={`text-xs font-semibold mt-1 ${styles.trend}`}>{trend}</div>}
        </div>
    );
};

export default StatCard;
```

- [ ] **Step 6: Create `Table.tsx`**

```tsx
import React from 'react';

interface TableProps {
    headers: string[];
    children: React.ReactNode;
    loading?: boolean;
    empty?: boolean;
    emptyMessage?: string;
    title?: string;
}

const Table: React.FC<TableProps> = ({ headers, children, loading, empty, emptyMessage = 'No records yet', title }) => (
    <div className="bg-white rounded-card shadow-soft overflow-hidden">
        {title && <div className="p-4 border-b border-slate-100 font-semibold text-slate-700 text-sm">{title}</div>}
        <table className="w-full text-sm">
            <thead className="text-left text-slate-400">
                <tr>
                    {headers.map((h) => (
                        <th key={h} className="p-3 font-medium text-xs uppercase tracking-wide">{h}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {loading ? (
                    <tr><td colSpan={headers.length} className="p-6 text-center text-slate-400">Loading...</td></tr>
                ) : empty ? (
                    <tr><td colSpan={headers.length} className="p-6 text-center text-slate-400">{emptyMessage}</td></tr>
                ) : children}
            </tbody>
        </table>
    </div>
);

export const Td: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className = '', ...rest }) => (
    <td className={`p-3 border-t border-slate-50 ${className}`} {...rest} />
);

export const Tr: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({ className = '', ...rest }) => (
    <tr className={`hover:bg-slate-50/50 ${className}`} {...rest} />
);

export default Table;
```

- [ ] **Step 7: Create the barrel `index.ts`**

```typescript
export { default as Card } from './Card';
export { default as Badge } from './Badge';
export type { BadgeTone } from './Badge';
export { default as Button } from './Button';
export type { ButtonVariant } from './Button';
export { default as PageHeader } from './PageHeader';
export { default as StatCard } from './StatCard';
export type { StatCardAccent } from './StatCard';
export { default as Table, Td, Tr } from './Table';
```

- [ ] **Step 8: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors (these files aren't imported anywhere yet, so this mainly checks each file is independently well-typed).

- [ ] **Step 9: Commit**

```bash
cd warehouse-client
git add src/components/ui/
git commit -m "feat(ui): add shared Card, Badge, Button, PageHeader, StatCard, Table components"
```

---

### Task 3: Responsive Layout shell

**Files:**
- Modify: `warehouse-client/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `Button` from `./ui` (Task 2).
- Produces: no new exports — `Layout` remains the default export consumed by `App.tsx`, same as today (no change needed in `App.tsx`).

The current file is:

```tsx
import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { LayoutDashboard, Building2, Warehouse, PackageSearch, BarChart3, Users, Receipt, Wallet, Contact, ClipboardCheck, Banknote, LogOut, KeyRound } from 'lucide-react';

const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/companies', label: 'Companies', icon: Building2 },
    { to: '/warehouses', label: 'Warehouses', icon: Warehouse },
    { to: '/box-events', label: 'Box Events', icon: PackageSearch },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
];

const Layout: React.FC = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const permissions = user?.EFFECTIVE_PERMISSIONS || [];
    const navItems = [
        ...NAV_ITEMS,
        ...(permissions.includes('manage_expenses') ? [{ to: '/expenses', label: 'Expenses', icon: Wallet }] : []),
        ...(permissions.includes('manage_staff') ? [{ to: '/staff', label: 'Staff', icon: Contact }] : []),
        ...(permissions.includes('manage_staff') ? [{ to: '/attendance', label: 'Attendance', icon: ClipboardCheck }] : []),
        ...(permissions.includes('manage_payroll') ? [{ to: '/payroll', label: 'Payroll', icon: Banknote }] : []),
        ...(permissions.includes('manage_users') ? [{ to: '/users', label: 'Users', icon: Users }] : []),
        ...(permissions.includes('view_invoices') ? [{ to: '/invoices', label: 'Invoices', icon: Receipt }] : []),
    ];

    const [showChangePassword, setShowChangePassword] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/users/me/change-password', { current_password: currentPassword, new_password: newPassword });
            toast.success('Password changed');
            setCurrentPassword('');
            setNewPassword('');
            setShowChangePassword(false);
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to change password');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex h-screen bg-slate-50">
            <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
                <div className="p-4 border-b border-slate-200">
                    <h1 className="font-bold text-lg text-slate-800">DOK Warehouse</h1>
                </div>
                <nav className="flex-1 p-3 space-y-1">
                    {navItems.map(({ to, label, icon: Icon }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={to === '/'}
                            className={({ isActive }) =>
                                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                                    isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                                }`
                            }
                        >
                            <Icon size={18} />
                            {label}
                        </NavLink>
                    ))}
                </nav>
                <div className="p-3 border-t border-slate-200 space-y-1">
                    <div className="text-sm text-slate-500 mb-2">{user?.NAME}</div>
                    <button
                        onClick={() => setShowChangePassword(true)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 w-full"
                    >
                        <KeyRound size={18} />
                        Change Password
                    </button>
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 w-full"
                    >
                        <LogOut size={18} />
                        Logout
                    </button>
                </div>
            </aside>
            <main className="flex-1 overflow-auto p-6">
                <Outlet />
            </main>

            {showChangePassword && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                    <form onSubmit={handleChangePassword} className="bg-white rounded-xl border border-slate-200 p-6 w-80 space-y-3">
                        <h2 className="text-lg font-semibold text-slate-800">Change Password</h2>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Current Password</label>
                            <input type="password" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">New Password</label>
                            <input type="password" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setShowChangePassword(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                            <button type="submit" disabled={submitting} className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                                {submitting ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Layout;
```

- [ ] **Step 1: Replace the file**

```tsx
import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { LayoutDashboard, Building2, Warehouse, PackageSearch, BarChart3, Users, Receipt, Wallet, Contact, ClipboardCheck, Banknote, LogOut, KeyRound, Menu, X } from 'lucide-react';
import { Button } from './ui';

const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/companies', label: 'Companies', icon: Building2 },
    { to: '/warehouses', label: 'Warehouses', icon: Warehouse },
    { to: '/box-events', label: 'Box Events', icon: PackageSearch },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
];

const Layout: React.FC = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const permissions = user?.EFFECTIVE_PERMISSIONS || [];
    const navItems = [
        ...NAV_ITEMS,
        ...(permissions.includes('manage_expenses') ? [{ to: '/expenses', label: 'Expenses', icon: Wallet }] : []),
        ...(permissions.includes('manage_staff') ? [{ to: '/staff', label: 'Staff', icon: Contact }] : []),
        ...(permissions.includes('manage_staff') ? [{ to: '/attendance', label: 'Attendance', icon: ClipboardCheck }] : []),
        ...(permissions.includes('manage_payroll') ? [{ to: '/payroll', label: 'Payroll', icon: Banknote }] : []),
        ...(permissions.includes('manage_users') ? [{ to: '/users', label: 'Users', icon: Users }] : []),
        ...(permissions.includes('view_invoices') ? [{ to: '/invoices', label: 'Invoices', icon: Receipt }] : []),
    ];

    const [showChangePassword, setShowChangePassword] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/users/me/change-password', { current_password: currentPassword, new_password: newPassword });
            toast.success('Password changed');
            setCurrentPassword('');
            setNewPassword('');
            setShowChangePassword(false);
        } catch (err: any) {
            toast.error(err?.response?.data?.message || 'Failed to change password');
        } finally {
            setSubmitting(false);
        }
    };

    const sidebarContent = (
        <>
            <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-600 to-brand-400" />
                <h1 className="font-extrabold text-sm text-slate-800">DOK Warehouse</h1>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {navItems.map(({ to, label, icon: Icon }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={to === '/'}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) =>
                            `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                                isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                            }`
                        }
                    >
                        <Icon size={18} />
                        {label}
                    </NavLink>
                ))}
            </nav>
            <div className="p-3 border-t border-slate-100 space-y-1">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-2 mb-2">{user?.NAME}</div>
                <button
                    onClick={() => setShowChangePassword(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 w-full"
                >
                    <KeyRound size={18} />
                    Change Password
                </button>
                <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 w-full"
                >
                    <LogOut size={18} />
                    Logout
                </button>
            </div>
        </>
    );

    return (
        <div className="flex h-screen bg-slate-50">
            <aside className="hidden lg:flex w-56 bg-white border-r border-slate-200 flex-col">
                {sidebarContent}
            </aside>

            <div
                className={`fixed inset-0 z-40 bg-black/30 transition-opacity lg:hidden ${sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                onClick={() => setSidebarOpen(false)}
            />
            <aside
                className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform lg:hidden ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <div className="flex justify-end p-2">
                    <button onClick={() => setSidebarOpen(false)} className="p-2 text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>
                {sidebarContent}
            </aside>

            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="lg:hidden flex items-center gap-3 bg-white border-b border-slate-200 px-4 py-3">
                    <button onClick={() => setSidebarOpen(true)} className="text-slate-500 hover:text-slate-700">
                        <Menu size={22} />
                    </button>
                    <span className="font-bold text-sm text-slate-800">DOK Warehouse</span>
                </div>
                <main className="flex-1 overflow-auto p-4 lg:p-6">
                    <Outlet />
                </main>
            </div>

            {showChangePassword && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
                    <form onSubmit={handleChangePassword} className="bg-white rounded-card shadow-soft p-6 w-full max-w-xs space-y-3">
                        <h2 className="text-lg font-semibold text-slate-800">Change Password</h2>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Current Password</label>
                            <input type="password" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">New Password</label>
                            <input type="password" className="border border-slate-300 rounded-lg px-3 py-2 w-full" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <Button type="button" variant="ghost" onClick={() => setShowChangePassword(false)}>Cancel</Button>
                            <Button type="submit" variant="primary" disabled={submitting}>
                                {submitting ? 'Saving...' : 'Save'}
                            </Button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default Layout;
```

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify the responsive drawer**

Start the dev server (`cd warehouse-client && npm run dev`, or use the `run` skill if available), log in, and check with a Playwright script (or the browser devtools' responsive mode) at two widths:
- ≥1024px: the fixed sidebar is visible, no hamburger button.
- <1024px (e.g. 768px, a typical tablet portrait width): the fixed sidebar is hidden, a hamburger button appears in a top bar; clicking it slides the drawer in from the left with a backdrop; clicking the backdrop or the `X` closes it; clicking a nav link inside the drawer both navigates AND closes the drawer.

Take screenshots at both widths as evidence (matching this session's established live-verification pattern for frontend changes).

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/components/Layout.tsx
git commit -m "feat(ui): restyle Layout with new design tokens and a responsive off-canvas sidebar"
```

---

### Task 4: Login page redesign

**Files:**
- Modify: `warehouse-client/src/pages/Login.tsx`

**Interfaces:**
- Consumes: `Button` from `../components/ui` (Task 2).
- Produces: no new exports — `Login` remains the default export consumed by `App.tsx`, unchanged there.

The current file is:

```tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { LoginResponse } from '../types';

const Login: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await api.post<LoginResponse>('/auth/login', { username, password });
            login(res.data);
            navigate('/');
        } catch (err) {
            toast.error('Invalid username or password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center h-screen bg-slate-50">
            <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 w-80">
                <h1 className="text-xl font-bold text-slate-800 mb-6">DOK Warehouse Login</h1>
                <label className="block text-sm font-medium text-slate-600 mb-1">Username</label>
                <input
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                />
                <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
                <input
                    type="password"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-6"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? 'Signing in...' : 'Sign in'}
                </button>
            </form>
        </div>
    );
};

export default Login;
```

- [ ] **Step 1: Replace the file**

```tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { LoginResponse } from '../types';
import { Button } from '../components/ui';

const Login: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await api.post<LoginResponse>('/auth/login', { username, password });
            login(res.data);
            navigate('/');
        } catch (err) {
            toast.error('Invalid username or password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-screen">
            <div className="hidden md:flex md:w-1/2 bg-gradient-to-br from-brand-600 to-brand-400 text-white flex-col justify-center px-16">
                <div className="w-12 h-12 rounded-xl bg-white/20 mb-6" />
                <h1 className="text-3xl font-extrabold mb-3">DOK Warehouse</h1>
                <p className="text-sm text-white/85 max-w-sm">Document archiving &amp; warehouse management, simplified.</p>
            </div>
            <div className="flex-1 flex items-center justify-center bg-slate-50 px-6">
                <form onSubmit={handleSubmit} className="bg-white p-8 rounded-card shadow-soft w-full max-w-sm">
                    <h2 className="text-xl font-bold text-slate-800 mb-1">Welcome back</h2>
                    <p className="text-sm text-slate-400 mb-6">Sign in to your account</p>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Username</label>
                    <input
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                    />
                    <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
                    <input
                        type="password"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-6"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                    <Button type="submit" variant="primary" disabled={loading} className="w-full">
                        {loading ? 'Signing in...' : 'Sign in'}
                    </Button>
                </form>
            </div>
        </div>
    );
};

export default Login;
```

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify**

With the dev server running, screenshot the login page at desktop width (both panels visible) and at mobile width (`<768px`, left panel hidden per `md:flex`, single centered form). Log in with `admin`/`password123` to confirm `handleSubmit` still works unchanged (correct redirect to `/`, error toast on wrong credentials).

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/pages/Login.tsx
git commit -m "feat(ui): redesign Login as a two-panel branded layout"
```

---

### Task 5: Dashboard redesign + enrichment

**Files:**
- Modify: `warehouse-client/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `StatCard`, `Table`, `Td`, `Tr`, `Badge`, `PageHeader`, `BadgeTone`, `StatCardAccent` from `../components/ui` (Task 2). Consumes existing types `CompanySummaryRow`, `BoxEvent`, `Department`, `MonthlySummaryRow`, `Invoice` from `../types` (all already defined, no type changes needed). Consumes `GET /summary/companies`, `GET /box-events`, `GET /departments`, `GET /summary/monthly?from=&to=`, and (conditionally) `GET /invoices` — all already-existing endpoints, no backend changes.
- Produces: no new exports — `Dashboard` remains the default export consumed by `App.tsx`, unchanged there.

The current file is:

```tsx
import React, { useEffect, useState } from 'react';
import api from '../services/api';
import type { CompanySummaryRow, BoxEvent } from '../types';

const Dashboard: React.FC = () => {
    const [companies, setCompanies] = useState<CompanySummaryRow[]>([]);
    const [recentEvents, setRecentEvents] = useState<BoxEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            api.get<CompanySummaryRow[]>('/summary/companies'),
            api.get<BoxEvent[]>('/box-events'),
        ]).then(([companiesRes, eventsRes]) => {
            setCompanies(companiesRes.data);
            setRecentEvents(eventsRes.data.slice(0, 10));
        }).finally(() => setLoading(false));
    }, []);

    const totalBoxes = companies.reduce((sum, c) => sum + c.TOTAL_BOX_COUNT, 0);

    if (loading) return <div>Loading...</div>;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>

            <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-sm text-slate-500">Total Boxes in Storage</div>
                    <div className="text-3xl font-bold text-slate-800">{totalBoxes.toLocaleString()}</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-sm text-slate-500">Active Companies</div>
                    <div className="text-3xl font-bold text-slate-800">{companies.length}</div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="text-sm text-slate-500">Recent Events</div>
                    <div className="text-3xl font-bold text-slate-800">{recentEvents.length}</div>
                </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200">
                <div className="p-4 border-b border-slate-200 font-semibold text-slate-700">Recent Box Events</div>
                <table className="w-full text-sm">
                    <thead className="text-left text-slate-500">
                        <tr>
                            <th className="p-3">Date</th>
                            <th className="p-3">Company</th>
                            <th className="p-3">Department</th>
                            <th className="p-3">Type</th>
                            <th className="p-3">Qty</th>
                        </tr>
                    </thead>
                    <tbody>
                        {recentEvents.map((e) => (
                            <tr key={e.ID} className="border-t border-slate-100">
                                <td className="p-3">{e.EVENT_DATE}</td>
                                <td className="p-3">{e.COMPANY_NAME}</td>
                                <td className="p-3">{e.DEPARTMENT_NAME}</td>
                                <td className="p-3 capitalize">{e.EVENT_TYPE.replace('_', ' ')}</td>
                                <td className="p-3">{e.QUANTITY}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Dashboard;
```

- [ ] **Step 1: Replace the file**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { CompanySummaryRow, BoxEvent, Department, MonthlySummaryRow, Invoice } from '../types';
import { StatCard, Table, Td, Tr, Badge, PageHeader } from '../components/ui';
import type { BadgeTone } from '../components/ui';
import { Package, Building2, Wallet, Zap } from 'lucide-react';

const EVENT_BADGE: Record<string, BadgeTone> = {
    archived: 'success',
    retrieved: 'info',
    empty_carton_issued: 'neutral',
    disposed: 'danger',
};

const EVENT_LABEL: Record<string, string> = {
    archived: 'Archived',
    retrieved: 'Retrieved',
    empty_carton_issued: 'Empty Carton',
    disposed: 'Disposed',
};

function monthRange(): { from: string; to: string } {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { from, to };
}

function last6MonthsRange(): { from: string; to: string } {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { from, to };
}

const Dashboard: React.FC = () => {
    const { user } = useAuth();
    const canViewInvoices = user?.EFFECTIVE_PERMISSIONS?.includes('view_invoices') ?? false;

    const [companies, setCompanies] = useState<CompanySummaryRow[]>([]);
    const [allEvents, setAllEvents] = useState<BoxEvent[]>([]);
    const [departments, setDepartments] = useState<Department[]>([]);
    const [monthly, setMonthly] = useState<MonthlySummaryRow[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const { from, to } = last6MonthsRange();
        const requests: Promise<any>[] = [
            api.get<CompanySummaryRow[]>('/summary/companies'),
            api.get<BoxEvent[]>('/box-events'),
            api.get<Department[]>('/departments'),
            api.get<MonthlySummaryRow[]>(`/summary/monthly?from=${from}&to=${to}`),
        ];
        if (canViewInvoices) {
            requests.push(api.get<Invoice[]>('/invoices'));
        }
        Promise.all(requests).then(([companiesRes, eventsRes, deptsRes, monthlyRes, invoicesRes]) => {
            setCompanies(companiesRes.data);
            setAllEvents(eventsRes.data);
            setDepartments(deptsRes.data);
            setMonthly(monthlyRes.data);
            if (invoicesRes) setInvoices(invoicesRes.data);
        }).finally(() => setLoading(false));
    }, [canViewInvoices]);

    const totalBoxes = companies.reduce((sum, c) => sum + c.TOTAL_BOX_COUNT, 0);
    const recentEvents = allEvents.slice(0, 8);

    const eventsThisWeek = useMemo(() => {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return allEvents.filter((e) => new Date(e.EVENT_DATE) >= weekAgo);
    }, [allEvents]);

    const revenueThisMonth = useMemo(() => {
        const { from, to } = monthRange();
        return invoices
            .filter((inv) => inv.CREATED_AT >= from && inv.CREATED_AT <= `${to}T23:59:59`)
            .reduce((sum, inv) => sum + inv.TOTAL_AMOUNT, 0);
    }, [invoices]);

    const boxesByWarehouse = useMemo(() => {
        const map = new Map<string, number>();
        for (const d of departments) {
            const name = d.WAREHOUSE_NAME || 'Unknown';
            map.set(name, (map.get(name) || 0) + d.CURRENT_BOX_COUNT);
        }
        return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    }, [departments]);

    const maxWarehouseCount = Math.max(1, ...boxesByWarehouse.map(([, count]) => count));

    const archivedRetrievedByMonth = monthly.map((m) => ({
        month: m.MONTH,
        total: m.ARCHIVED + m.RETRIEVED,
    }));
    const maxMonthTotal = Math.max(1, ...archivedRetrievedByMonth.map((m) => m.total));

    const archivedThisWeek = eventsThisWeek.filter((e) => e.EVENT_TYPE === 'archived').length;
    const retrievedThisWeek = eventsThisWeek.filter((e) => e.EVENT_TYPE === 'retrieved').length;

    if (loading) return <div className="text-slate-400 text-sm">Loading dashboard...</div>;

    return (
        <div className="space-y-5">
            <PageHeader title="Dashboard" subtitle="Here's what's happening across your warehouses today" />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    label="Total Boxes"
                    value={totalBoxes.toLocaleString()}
                    icon={Package}
                    accent="brand"
                />
                <StatCard
                    label="Active Companies"
                    value={String(companies.length)}
                    icon={Building2}
                    accent="sky"
                    trend={`across ${boxesByWarehouse.length} warehouse${boxesByWarehouse.length === 1 ? '' : 's'}`}
                />
                {canViewInvoices && (
                    <StatCard
                        label="Revenue This Month"
                        value={`LKR ${revenueThisMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                        icon={Wallet}
                        accent="green"
                    />
                )}
                <StatCard
                    label="Events This Week"
                    value={String(eventsThisWeek.length)}
                    icon={Zap}
                    accent="amber"
                    trend={`${archivedThisWeek} archived, ${retrievedThisWeek} retrieved`}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
                <div className="bg-white rounded-card shadow-soft p-4">
                    <div className="text-sm font-semibold text-slate-700 mb-4">Box Movement — Last 6 Months</div>
                    <div className="flex items-end gap-3 h-28">
                        {archivedRetrievedByMonth.map((m) => (
                            <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                                <div
                                    className="w-full rounded-t bg-gradient-to-b from-brand-400 to-brand-600"
                                    style={{ height: `${Math.max(4, (m.total / maxMonthTotal) * 100)}%` }}
                                />
                                <div className="text-[10px] text-slate-400">
                                    {new Date(m.month).toLocaleDateString(undefined, { month: 'short' })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="bg-white rounded-card shadow-soft p-4">
                    <div className="text-sm font-semibold text-slate-700 mb-4">Boxes by Warehouse</div>
                    {boxesByWarehouse.map(([name, count]) => (
                        <div key={name} className="mb-2.5 last:mb-0">
                            <div className="flex justify-between text-xs text-slate-500 mb-1">
                                <span>{name}</span>
                                <span className="font-semibold">{count.toLocaleString()}</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full">
                                <div
                                    className="h-full bg-brand-500 rounded-full"
                                    style={{ width: `${(count / maxWarehouseCount) * 100}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <Table headers={['Date', 'Company', 'Department', 'Type', 'Qty']} title="Recent Box Events" empty={recentEvents.length === 0}>
                {recentEvents.map((e) => (
                    <Tr key={e.ID}>
                        <Td>{e.EVENT_DATE}</Td>
                        <Td>{e.COMPANY_NAME}</Td>
                        <Td>{e.DEPARTMENT_NAME}</Td>
                        <Td><Badge tone={EVENT_BADGE[e.EVENT_TYPE]}>{EVENT_LABEL[e.EVENT_TYPE]}</Badge></Td>
                        <Td>{e.QUANTITY}</Td>
                    </Tr>
                ))}
            </Table>
        </div>
    );
};

export default Dashboard;
```

- [ ] **Step 2: Verify the build is clean**

Run: `cd warehouse-client && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Live-verify against the real backend**

With the dev server running and connected to the real `wh-postgres` database, log in as `admin`/`password123` (`system_admin`, holds `view_invoices`) and confirm: all 4 stat cards render with real numbers (Total Boxes, Active Companies, Revenue This Month, Events This Week), the 6-month bar chart renders with at least the current month's bar, the Boxes-by-Warehouse list renders one bar per warehouse that has departments, and the Recent Box Events table shows real rows with correctly color-coded badges (archived=green, retrieved=blue, disposed=red).

Then log in as a `warehouse_admin` test account that does NOT hold `view_invoices` (e.g. `staff1`/`password123`) and confirm the Revenue stat card is entirely absent (not rendered with 0/blank — literally not in the DOM), and that Boxes-by-Warehouse only shows that admin's own scoped warehouse(s), matching the existing server-side scoping on `GET /departments`.

Take screenshots of both states as evidence.

- [ ] **Step 4: Commit**

```bash
cd warehouse-client
git add src/pages/Dashboard.tsx
git commit -m "feat(ui): redesign Dashboard with revenue, warehouse breakdown, and movement chart widgets"
```

---

### Task 6: Final verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Full frontend build**

Run: `cd warehouse-client && npx tsc -b`
Expected: zero errors.

- [ ] **Step 2: Confirm the backend test suite is untouched and still green**

Run: `cd warehouse-server && npx jest`
Expected: PASS, same count as before this plan started (191/191 as of the last backend change) — this plan makes no backend changes, so this is a pure regression check.

- [ ] **Step 3: Full live walkthrough with screenshots**

With both the backend and frontend dev servers running against the real database, and using Playwright (per this session's established verification pattern), capture:
1. Login page at desktop width (both panels visible).
2. Login page at mobile width (`<768px`, single panel).
3. Dashboard as `system_admin` (all 4 stat cards, chart, warehouse breakdown, recent events table).
4. Dashboard as a scoped `warehouse_admin` without `view_invoices` (3 stat cards only, scoped warehouse breakdown).
5. Sidebar collapsed/hamburger view at tablet width (<1024px), both closed and open states.

Read each screenshot to visually confirm correctness (matching this session's established "don't just trust the script ran, look at the image" verification standard) before reporting success.

- [ ] **Step 4: Report**

Summarize: build status, backend regression check, and confirmation that all 5 screenshots were visually reviewed and match the approved mockups' design language (indigo accent, Inter font, soft-shadow cards, colored stat cards). No commit needed for this task unless a bug fix was required during verification (in which case commit that fix in its own commit).
