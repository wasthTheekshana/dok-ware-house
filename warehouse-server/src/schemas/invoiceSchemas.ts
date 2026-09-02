import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');

export const invoicePeriodSchema = z.object({
    department_id: z.number().int().positive(),
    period_from: dateStr,
    period_to: dateStr,
}).refine(data => data.period_from <= data.period_to, {
    message: 'period_from must be on or before period_to',
    path: ['period_to'],
});

export const invoiceQuerySchema = z.object({
    department_id: z.string().optional(),
    company_id: z.string().optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
});
