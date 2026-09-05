import { z } from 'zod';

export const PERMISSION_KEY_VALUES = [
    'manage_companies', 'manage_warehouses', 'manage_box_events',
    'view_invoices', 'manage_invoices', 'manage_users', 'manage_expenses', 'manage_staff',
] as const;

const permissionOverrideSchema = z.object({
    permission_key: z.enum(PERMISSION_KEY_VALUES),
    granted: z.boolean(),
});

export const createUserSchema = z.object({
    username: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    password: z.string().min(6).max(255),
    role: z.enum(['system_admin', 'warehouse_admin', 'finance_officer']),
    warehouse_ids: z.array(z.number().int().positive()).optional(),
});

export const updateUserSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    role: z.enum(['system_admin', 'warehouse_admin', 'finance_officer']).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    password: z.string().min(6).max(255).optional(),
    warehouse_ids: z.array(z.number().int().positive()).optional(),
    permission_overrides: z.array(permissionOverrideSchema).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });

export const changePasswordSchema = z.object({
    current_password: z.string().min(1),
    new_password: z.string().min(6).max(255),
});
