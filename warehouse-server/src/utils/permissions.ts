export type PermissionKey =
    | 'manage_companies'
    | 'manage_warehouses'
    | 'manage_box_events'
    | 'view_invoices'
    | 'manage_invoices'
    | 'manage_users'
    | 'manage_expenses'
    | 'manage_staff';

export const ALL_PERMISSION_KEYS: PermissionKey[] = [
    'manage_companies',
    'manage_warehouses',
    'manage_box_events',
    'view_invoices',
    'manage_invoices',
    'manage_users',
    'manage_expenses',
    'manage_staff',
];

const ROLE_DEFAULTS: Record<string, PermissionKey[]> = {
    system_admin: [
        'manage_companies', 'manage_warehouses', 'manage_box_events',
        'view_invoices', 'manage_invoices', 'manage_users', 'manage_expenses', 'manage_staff',
    ],
    warehouse_admin: ['manage_box_events', 'manage_expenses', 'manage_staff'],
    finance_officer: ['view_invoices', 'manage_invoices'],
};

export interface PermissionOverride {
    permission_key: PermissionKey;
    granted: boolean;
}

export function computeEffectivePermissions(role: string, overrides: PermissionOverride[]): PermissionKey[] {
    const effective = new Set<PermissionKey>(ROLE_DEFAULTS[role] || []);
    for (const override of overrides) {
        if (override.granted) {
            effective.add(override.permission_key);
        } else {
            effective.delete(override.permission_key);
        }
    }
    return Array.from(effective);
}
