import { z } from 'zod';

export const auditLogQuerySchema = z.object({
    table_name: z.enum(['invoices', 'payroll', 'warehouse_expenses', 'staff', 'attendance']).optional(),
    record_id: z.string().regex(/^\d+$/, 'record_id must be numeric').optional(),
    actor_id: z.string().regex(/^\d+$/, 'actor_id must be numeric').optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').optional(),
});
