import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');

export const createBoxEventSchema = z.object({
    department_id: z.number().int().positive(),
    event_type: z.enum(['archived', 'retrieved', 'empty_carton_issued', 'disposed']),
    quantity: z.number().int().positive(),
    event_date: dateStr,
    reference_no: z.string().max(64).optional(),
    remarks: z.string().optional(),
});

export const updateBoxEventSchema = z.object({
    quantity: z.number().int().positive().optional(),
    event_date: dateStr.optional(),
    event_type: z.enum(['archived', 'retrieved', 'empty_carton_issued', 'disposed']).optional(),
    reference_no: z.string().max(64).optional(),
    remarks: z.string().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field required' });

export const boxEventQuerySchema = z.object({
    department_id: z.string().optional(),
    event_type: z.enum(['archived', 'retrieved', 'empty_carton_issued', 'disposed']).optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
});
