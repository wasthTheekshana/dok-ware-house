import { z } from 'zod';

export const auditLogQuerySchema = z.object({
    table_name: z.enum(['invoices', 'payroll', 'warehouse_expenses', 'staff', 'attendance']).optional(),
    record_id: z.string().regex(/^\d+$/, 'record_id must be numeric').optional(),
    actor_id: z.string().regex(/^\d+$/, 'actor_id must be numeric').optional(),
    from: z.string().optional(),
    to: z.string().optional(),
});
